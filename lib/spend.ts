import { createAdminClient } from "@/lib/supabase/admin";
import { boScopeMatchesRequest, hasAnyRole, isSuperadmin, rolesOf } from "@/lib/permissions";
import type { CurrentUser, ExpenseRequest } from "@/types/database";

// ---------------------------------------------------------------------------
// Business decisions still being confirmed — single source of truth.
// Nothing else in this feature may hardcode a status or an amount field.
// ---------------------------------------------------------------------------

// Flip to 'amount_net' if budgets are set pre-VAT.
// Both columns are exposed by v_spend_by_segment_month, so this is a real
// switch, not a rename.
export const SPEND_AMOUNT_FIELD = "total" as const;

// Flip to 'created_at' if requests.budget_period turns out unusable.
//
// It IS usable as of this writing: all 991 live requests hold a valid
// 'YYYY-MM' string (verified by direct query). Note the column is TEXT, so
// migration 016 parses it with to_date() rather than extract().
//
// 'created_at' selects the v_spend_by_segment_month_ts view instead, which
// keys on requests."timestamp" — deliberately NOT requests.created_at, which
// is the row INSERT time and is 2026-07-21 for every one of the ~825 legacy
// rows imported by scripts/import-expensedb-requests.ts. Keying on created_at
// literally would pile three quarters of the history into a single month.
export const SPEND_PERIOD_FIELD = "budget_period" as const;

// Real status strings, corrected against lib/constants.ts#STATUSES and the
// live data. Differences from the values this feature's spec assumed:
//   - There is no 'DRAFT' status in this schema, and never has been.
//   - PO_UPLOADED is pending too. A request sitting at PO_UPLOADED is
//     awaiting BO (or CEO, when skip_bo) approval — omitting it would hide
//     committed-but-unapproved money from the Pending column entirely.
//   - EDIT_REQUESTED is counted as pending. It is a transient state a request
//     only enters from BO_APPROVED/CEO_APPROVED/PAID (see CLAUDE.md "Edit
//     Request approval workflow"), so counting it as actual would be wrong
//     for some rows and counting it as pending is wrong for others; pending
//     is the conservative reading, and it is rare enough not to move a total.
export const ACTUAL_APPROVED = ["CEO_APPROVED", "PAID"] as const;
export const ACTUAL_PAID = ["PAID"] as const;
export const PENDING_STATUS = ["SUBMITTED", "PO_UPLOADED", "BO_APPROVED", "EDIT_REQUESTED"] as const;

export type SpendBasis = "approved" | "paid";
export type SpendGranularity = "month" | "quarter" | "year";

export const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface SpendCell {
  budget: number;
  actual: number;
  pending: number;
}

export interface SpendNode {
  key: string; // department | department>cat_l1 | department>cat_l1>cat_l2
  name: string;
  byMonth: Record<number, SpendCell>;
  total: SpendCell; // over `months` only
  unbudgeted: boolean; // every month's budget absent or 0
  children?: SpendNode[];
}

export interface SpendPendingRequest {
  request_id: string;
  description: string;
  status: string;
  amount: number;
}

export interface SpendReport {
  months: number[];
  totals: { budget: number; actual: number; pending: number; prevActual: number };
  trend: { month: number; actual: number; pending: number; budget: number }[];
  rows: SpendNode[];
  pending_requests: SpendPendingRequest[];
}

export interface SpendReportParams {
  bu: string | null; // null = all business units
  fiscalYear: number;
  months: number[];
  basis: SpendBasis;
  departmentFilter?: string | null;
  viewer: CurrentUser;
}

// --- internal row shapes ---------------------------------------------------

interface SpendAggRow {
  bu: string;
  fiscal_year: number;
  month: number;
  department: string | null;
  cat_l1: string | null;
  cat_l2: string | null;
  status: string;
  amount: number | string;
  amount_net: number | string;
}

interface BudgetRow {
  bu: string;
  department: string;
  cat_l1: string | null;
  cat_l2: string | null;
  fiscal_year: number;
  month: number;
  amount: number | string;
}

const UNCATEGORIZED = "(uncategorized)";

function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function label(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? UNCATEGORIZED : trimmed;
}

function emptyCell(): SpendCell {
  return { budget: 0, actual: 0, pending: 0 };
}

// PostgREST caps a single response at max_rows (1000 by default, and that is
// what this project runs — supabase/config.toml). The aggregate view is at
// 442 rows for FY2026, comfortably under it today, but it grows with every
// new (segment, category, month, status) combination, so a plain select
// would start silently truncating — and a truncated aggregate reads as a
// perfectly plausible, quietly wrong report rather than an error. Paging
// makes that impossible regardless of how the data grows.
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// The aggregate view keyed on whichever period derivation SPEND_PERIOD_FIELD
// selects. See migration 016 — both views expose an identical column list.
function spendViewName(): string {
  return SPEND_PERIOD_FIELD === "budget_period"
    ? "v_spend_by_segment_month"
    : "v_spend_by_segment_month_ts";
}

function amountOf(row: SpendAggRow): number {
  return SPEND_AMOUNT_FIELD === "total" ? num(row.amount) : num(row.amount_net);
}

/**
 * The window of equal length immediately preceding `months` within
 * `fiscalYear`. Each month shifts back by the window's own length, so a
 * 1-month window steps back one month, a quarter steps back a quarter, and
 * a 12-month window steps back a whole year. Months that fall off the front
 * of January wrap into the previous fiscal year.
 */
export function previousWindow(
  fiscalYear: number,
  months: number[],
): { fiscalYear: number; month: number }[] {
  const span = months.length;
  return months.map((m) => {
    const shifted = m - span;
    return shifted < 1
      ? { fiscalYear: fiscalYear - 1, month: shifted + 12 }
      : { fiscalYear, month: shifted };
  });
}

// --- scoping ---------------------------------------------------------------

// Reuses /bo-approvals' existing scope helper rather than introducing a
// second one. boScopeMatchesRequest checks bu_scope/dept_scope/cat_l1_scope
// against a request's bu/department/cat_l1 — the aggregate rows carry exactly
// those three fields, so they are passed through the same predicate.
function scopeFilter(viewer: CurrentUser): ((row: {
  bu: string;
  department: string | null;
  cat_l1: string | null;
}) => boolean) | "all" | "none" {
  if (isSuperadmin(viewer) || hasAnyRole(viewer, ["CEO", "ACCOUNTING"])) return "all";

  const boScopes = rolesOf(viewer, "BO");
  // No scope at all → return nothing, never everything.
  if (boScopes.length === 0) return "none";

  return (row) =>
    boScopes.some((scope) =>
      boScopeMatchesRequest(scope, {
        bu: row.bu,
        department: row.department ?? "",
        cat_l1: row.cat_l1,
      } as ExpenseRequest),
    );
}

// --- tree building ---------------------------------------------------------

interface MutableNode {
  key: string;
  name: string;
  byMonth: Map<number, SpendCell>;
  children: Map<string, MutableNode>;
}

function makeNode(key: string, name: string): MutableNode {
  return { key, name, byMonth: new Map(), children: new Map() };
}

function cellFor(node: MutableNode, month: number): SpendCell {
  let cell = node.byMonth.get(month);
  if (!cell) {
    cell = emptyCell();
    node.byMonth.set(month, cell);
  }
  return cell;
}

/**
 * Adds a figure to a (department, cat_l1, cat_l2) path and every ancestor of
 * it, creating nodes on the way. This is what makes the join a FULL OUTER
 * one: budget rows and actual rows both call it, so a path present in only
 * one of the two still materialises, with zero on the other side.
 */
function addToTree(
  roots: Map<string, MutableNode>,
  path: [string, string, string],
  month: number,
  field: keyof SpendCell,
  value: number,
): void {
  const [dept, l1, l2] = path;

  let node = roots.get(dept);
  if (!node) {
    node = makeNode(dept, dept);
    roots.set(dept, node);
  }
  cellFor(node, month)[field] += value;

  const l1Key = `${dept}>${l1}`;
  let l1Node = node.children.get(l1Key);
  if (!l1Node) {
    l1Node = makeNode(l1Key, l1);
    node.children.set(l1Key, l1Node);
  }
  cellFor(l1Node, month)[field] += value;

  const l2Key = `${l1Key}>${l2}`;
  let l2Node = l1Node.children.get(l2Key);
  if (!l2Node) {
    l2Node = makeNode(l2Key, l2);
    l1Node.children.set(l2Key, l2Node);
  }
  cellFor(l2Node, month)[field] += value;
}

const EPSILON = 0.005;

function isEmptyCell(cell: SpendCell): boolean {
  return (
    Math.abs(cell.budget) < EPSILON &&
    Math.abs(cell.actual) < EPSILON &&
    Math.abs(cell.pending) < EPSILON
  );
}

function finalizeNode(node: MutableNode, months: number[]): SpendNode {
  const byMonth: Record<number, SpendCell> = {};
  const total = emptyCell();
  let anyBudget = false;

  for (const month of months) {
    const cell = node.byMonth.get(month);
    // A month with neither budget nor actual gets NO key — the UI renders an
    // em dash for a missing key and would render a misleading 0 for a zero.
    if (!cell || isEmptyCell(cell)) continue;
    byMonth[month] = { ...cell };
    total.budget += cell.budget;
    total.actual += cell.actual;
    total.pending += cell.pending;
    if (Math.abs(cell.budget) >= EPSILON) anyBudget = true;
  }

  const children = Array.from(node.children.values())
    .map((child) => finalizeNode(child, months))
    // Drop branches that are entirely outside the selected window.
    .filter((child) => Object.keys(child.byMonth).length > 0);

  return {
    key: node.key,
    name: node.name,
    byMonth,
    total,
    unbudgeted: !anyBudget,
    children: children.length > 0 ? sortNodes(children) : undefined,
  };
}

// Budgeted segments by total actual desc; unbudgeted segments last.
function sortNodes(nodes: SpendNode[]): SpendNode[] {
  return nodes.sort((a, b) => {
    if (a.unbudgeted !== b.unbudgeted) return a.unbudgeted ? 1 : -1;
    if (b.total.actual !== a.total.actual) return b.total.actual - a.total.actual;
    return a.name.localeCompare(b.name);
  });
}

// --- main entry point ------------------------------------------------------

export async function getSpendReport(params: SpendReportParams): Promise<SpendReport> {
  const { bu, fiscalYear, months, basis, departmentFilter, viewer } = params;

  const scope = scopeFilter(viewer);
  if (scope === "none") {
    return {
      months,
      totals: { budget: 0, actual: 0, pending: 0, prevActual: 0 },
      trend: ALL_MONTHS.map((month) => ({ month, actual: 0, pending: 0, budget: 0 })),
      rows: [],
      pending_requests: [],
    };
  }

  const supabase = createAdminClient();
  const actualStatuses: readonly string[] =
    basis === "paid" ? ACTUAL_PAID : ACTUAL_APPROVED;
  const pendingStatuses: readonly string[] = PENDING_STATUS;

  // ---- Query 1: spend, pre-aggregated per (segment, category, month) in SQL.
  // Both the selected fiscal year and the one before it, so the previous
  // window for a January/Q1 selection is covered without a second round trip.
  // The full 12 months always come back — the trend chart needs them
  // regardless of `months`, and filtering months here would cost a query.
  const buildSpendQuery = () => {
    let q = supabase
      .from(spendViewName())
      .select("bu, fiscal_year, month, department, cat_l1, cat_l2, status, amount, amount_net")
      .in("fiscal_year", [fiscalYear - 1, fiscalYear])
      .in("status", [...actualStatuses, ...pendingStatuses]);
    if (bu) q = q.eq("bu", bu);
    if (departmentFilter) q = q.eq("department", departmentFilter);
    return q;
  };

  // ---- Query 2: budgets for the selected fiscal year.
  const buildBudgetQuery = () => {
    let q = supabase
      .from("budgets")
      .select("bu, department, cat_l1, cat_l2, fiscal_year, month, amount")
      .eq("fiscal_year", fiscalYear);
    if (bu) q = q.eq("bu", bu);
    if (departmentFilter) q = q.eq("department", departmentFilter);
    return q;
  };

  // ---- Query 3: the pending request list. A different grain from the two
  // aggregates above (one row per request, not per segment-month), so it
  // cannot come out of the same view. Still a single query — nothing here
  // loops months issuing requests, which is what the "two queries" rule is
  // guarding against.
  let pendingQuery = supabase
    .from("requests")
    .select("request_id, description, items_summary, status, total, amount_net, bu, department, cat_l1, budget_period")
    .in("status", pendingStatuses)
    .like("budget_period", `${fiscalYear}-%`)
    .order("total", { ascending: false })
    .limit(200);
  if (bu) pendingQuery = pendingQuery.eq("bu", bu);
  if (departmentFilter) pendingQuery = pendingQuery.eq("department", departmentFilter);

  const [allSpendRows, allBudgetRows, pendingRes] = await Promise.all([
    fetchAllPages<SpendAggRow>(buildSpendQuery),
    fetchAllPages<BudgetRow>(buildBudgetQuery),
    pendingQuery,
  ]);

  if (pendingRes.error) throw pendingRes.error;

  const inScope = scope === "all" ? () => true : scope;

  const spendRows = allSpendRows.filter(inScope);
  const budgetRows = allBudgetRows.filter(inScope);

  // ---- Build the tree over the selected fiscal year.
  const roots = new Map<string, MutableNode>();
  const trendActual = new Map<number, number>();
  const trendPending = new Map<number, number>();
  const trendBudget = new Map<number, number>();

  const prev = previousWindow(fiscalYear, months);
  const prevKeys = new Set(prev.map((p) => `${p.fiscalYear}-${p.month}`));
  let prevActual = 0;

  for (const row of spendRows) {
    const value = amountOf(row);
    const isActual = actualStatuses.includes(row.status);
    const isPending = pendingStatuses.includes(row.status);

    if (isActual && prevKeys.has(`${row.fiscal_year}-${row.month}`)) {
      prevActual += value;
    }

    if (row.fiscal_year !== fiscalYear) continue;

    const path: [string, string, string] = [
      label(row.department),
      label(row.cat_l1),
      label(row.cat_l2),
    ];

    if (isActual) {
      addToTree(roots, path, row.month, "actual", value);
      trendActual.set(row.month, (trendActual.get(row.month) ?? 0) + value);
    } else if (isPending) {
      addToTree(roots, path, row.month, "pending", value);
      trendPending.set(row.month, (trendPending.get(row.month) ?? 0) + value);
    }
  }

  for (const row of budgetRows) {
    const value = num(row.amount);
    const path: [string, string, string] = [
      label(row.department),
      label(row.cat_l1),
      label(row.cat_l2),
    ];
    addToTree(roots, path, row.month, "budget", value);
    trendBudget.set(row.month, (trendBudget.get(row.month) ?? 0) + value);
  }

  const rows = sortNodes(
    Array.from(roots.values())
      .map((node) => finalizeNode(node, months))
      .filter((node) => Object.keys(node.byMonth).length > 0),
  );

  const totals = rows.reduce(
    (acc, row) => ({
      budget: acc.budget + row.total.budget,
      actual: acc.actual + row.total.actual,
      pending: acc.pending + row.total.pending,
      prevActual: acc.prevActual,
    }),
    { budget: 0, actual: 0, pending: 0, prevActual },
  );

  // Always all 12 months, ignoring `months`.
  const trend = ALL_MONTHS.map((month) => ({
    month,
    actual: trendActual.get(month) ?? 0,
    pending: trendPending.get(month) ?? 0,
    budget: trendBudget.get(month) ?? 0,
  }));

  // Top 20 by amount, after scope filtering and after narrowing to the
  // selected months (budget_period is 'YYYY-MM', so the month is its suffix).
  const monthSet = new Set(months);
  const pending_requests: SpendPendingRequest[] = ((pendingRes.data ?? []) as (ExpenseRequest & {
    budget_period: string;
  })[])
    .filter((r) =>
      inScope({ bu: r.bu, department: r.department, cat_l1: r.cat_l1 }),
    )
    .filter((r) => monthSet.has(Number((r.budget_period ?? "").slice(5, 7))))
    .map((r) => ({
      request_id: r.request_id,
      description: r.items_summary || r.description || "—",
      status: r.status,
      amount: SPEND_AMOUNT_FIELD === "total" ? num(r.total) : num(r.amount_net),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);

  return { months, totals, trend, rows, pending_requests };
}
