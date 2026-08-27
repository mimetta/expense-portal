import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import {
  MONTHS,
  getRevision,
  listRevisions,
  type BudgetLine,
  type BudgetRevision,
} from "@/lib/budget-revisions";
import type { CurrentUser } from "@/types/database";

// Read-side assembly for the budget editor UI. The state machine lives in
// lib/budget-revisions.ts; this file only shapes data for rendering.
// Server-side only — holds the service-role key.

export interface EditorRow {
  key: string;
  bu: string;
  department: string;
  cat_l1: string;
  cat_l2: string | null;
  /** 12 proposed figures, index 0 = January. */
  proposed: number[];
  /** 12 currently-approved figures — the comparison basis for highlighting. */
  approved: number[];
  /** 12 prior-fiscal-year actuals, for the copy-last-year row action. */
  priorActual: number[];
}

export interface EditorScope {
  departments: string[];
  catL1s: string[];
  bus: string[];
  /** Total category lines the owner holds, before any filter. */
  lineCount: number;
}

export interface EditorData {
  revision: BudgetRevision | null;
  rows: EditorRow[];
  scope: EditorScope;
  fiscalYear: number;
  priorFiscalYear: number;
  ownerEmail: string;
  /** Other owners holding lines in the same departments — the CEO banner. */
  coOwners: { email: string; departments: string[] }[];
}

const zero12 = () => Array.from({ length: 12 }, () => 0);
const rowKey = (l: { bu: string; department: string; cat_l1: string; cat_l2: string | null }) =>
  `${l.bu}|${l.department}|${l.cat_l1}|${l.cat_l2 ?? ""}`;

/**
 * Folds flat per-month rows into one row per line with a 12-slot array.
 * `pick` says which numeric field to read, so the same fold serves proposed
 * lines, approved lines and prior actuals.
 */
function foldMonths<T extends { bu: string; department: string; cat_l1: string | null; cat_l2: string | null; month: number }>(
  rows: T[],
  pick: (r: T) => number,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.cat_l1) continue;
    const k = rowKey({ bu: r.bu, department: r.department, cat_l1: r.cat_l1, cat_l2: r.cat_l2 });
    let arr = out.get(k);
    if (!arr) { arr = zero12(); out.set(k, arr); }
    if (r.month >= 1 && r.month <= 12) arr[r.month - 1] += pick(r);
  }
  return out;
}

/** Prior-year actuals per line, on the approved basis the spend report uses. */
async function priorYearActuals(priorFiscalYear: number): Promise<Map<string, number[]>> {
  const admin = createAdminClient();
  const out: { bu: string; department: string; cat_l1: string | null; cat_l2: string | null; month: number; amount: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("v_request_spend")
      .select("bu, department, cat_l1, cat_l2, month, amount, status, fiscal_year")
      .eq("fiscal_year", priorFiscalYear)
      .in("status", ["CEO_APPROVED", "PAID"])
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as never[];
    out.push(...(rows as unknown as typeof out));
    if (rows.length < 1000) break;
  }
  return foldMonths(out, (r) => Number(r.amount));
}

/**
 * The editor's grid for one revision: every line in the revision, each with
 * its proposed figures, the currently-approved figures to compare against,
 * and last year's actuals.
 */
export async function getEditorData(
  revisionId: string,
  viewer: CurrentUser,
): Promise<EditorData> {
  const { revision, lines } = await getRevision(revisionId, viewer);
  const admin = createAdminClient();

  const proposed = foldMonths(
    lines.map((l) => ({ ...l, cat_l1: l.cat_l1 as string | null })),
    (l) => Number(l.amount),
  );

  const { data: cur, error: curErr } = await admin
    .from("v_budget_current")
    .select("bu, department, cat_l1, cat_l2, month, amount")
    .eq("fiscal_year", revision.fiscal_year);
  if (curErr) throw curErr;
  const approved = foldMonths((cur ?? []) as never, (r: never) => Number((r as { amount: number }).amount));

  const priorFiscalYear = revision.fiscal_year - 1;
  const prior = await priorYearActuals(priorFiscalYear);

  const seen = new Map<string, EditorRow>();
  for (const l of lines) {
    const k = rowKey(l);
    if (seen.has(k)) continue;
    seen.set(k, {
      key: k,
      bu: l.bu,
      department: l.department,
      cat_l1: l.cat_l1,
      cat_l2: l.cat_l2,
      proposed: proposed.get(k) ?? zero12(),
      approved: approved.get(k) ?? zero12(),
      priorActual: prior.get(k) ?? zero12(),
    });
  }
  const rows = Array.from(seen.values()).sort(
    (a, b) =>
      a.department.localeCompare(b.department) ||
      a.cat_l1.localeCompare(b.cat_l1) ||
      (a.cat_l2 ?? "").localeCompare(b.cat_l2 ?? "") ||
      a.bu.localeCompare(b.bu),
  );

  const scope: EditorScope = {
    departments: Array.from(new Set(rows.map((r) => r.department))).sort(),
    catL1s: Array.from(new Set(rows.map((r) => r.cat_l1))).sort(),
    bus: Array.from(new Set(rows.map((r) => r.bu))).sort(),
    lineCount: rows.length,
  };

  return {
    revision,
    rows,
    scope,
    fiscalYear: revision.fiscal_year,
    priorFiscalYear,
    ownerEmail: revision.owner_email,
    coOwners: await coOwnersFor(revision.owner_email, scope.departments),
  };
}

/**
 * Other budget owners holding lines in the same departments. The CEO banner
 * depends on this: approving a cross-segment revision publishes a PARTIAL
 * view of each segment it touches, and the reviewer needs to know whose lines
 * make up the rest.
 */
export async function coOwnersFor(
  ownerEmail: string,
  departments: string[],
): Promise<{ email: string; departments: string[] }[]> {
  if (departments.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .select("email, bu_scope, dept_scope, cat_l1_scope")
    .eq("role", "BO")
    .neq("email", ownerEmail);
  if (error) throw error;

  const out: { email: string; departments: string[] }[] = [];
  for (const r of data ?? []) {
    const scoped = String(r.dept_scope) === "*"
      ? departments
      : departments.filter((d) => String(r.dept_scope).split(",").map((s) => s.trim()).includes(d));
    if (scoped.length > 0) out.push({ email: r.email as string, departments: scoped });
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

/** The owner's live draft for a year, if any. */
export async function findDraft(
  ownerEmail: string,
  fiscalYear: number,
): Promise<BudgetRevision | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_revisions")
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("fiscal_year", fiscalYear)
    .eq("status", "DRAFT")
    .maybeSingle();
  if (error) throw error;
  return (data as BudgetRevision) ?? null;
}

/** Does this viewer hold any BO scope covering at least one category line? */
export async function viewerHasBudgetScope(viewer: CurrentUser): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .select("id")
    .eq("email", viewer.email)
    .eq("role", "BO")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface HistoryRow extends BudgetRevision {
  fy_total: number;
  line_count: number;
  changed_count: number;
  departments: string[];
}

/**
 * History rows with each revision's FY total and how many figures differ from
 * what was approved at the time. ACCOUNTING sees these summary rows but not
 * the cell grid — see canOpenRevisionDetail.
 */
export async function listHistory(
  viewer: CurrentUser,
  opts: { fiscalYear?: number; ownerEmail?: string; status?: string } = {},
): Promise<HistoryRow[]> {
  const revisions = await listRevisions(viewer, opts);
  const filtered = opts.status ? revisions.filter((r) => r.status === opts.status) : revisions;
  if (filtered.length === 0) return [];

  const admin = createAdminClient();
  const ids = filtered.map((r) => r.id);
  const lines: BudgetLine[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await admin
      .from("budget_lines")
      .select("revision_id, bu, department, cat_l1, cat_l2, month, amount")
      .in("revision_id", ids.slice(i, i + 50));
    if (error) throw error;
    lines.push(...((data ?? []) as BudgetLine[]));
  }

  const byRev = new Map<string, BudgetLine[]>();
  for (const l of lines) {
    const k = l.revision_id as string;
    byRev.set(k, [...(byRev.get(k) ?? []), l]);
  }

  return filtered.map((r) => {
    const own = byRev.get(r.id) ?? [];
    return {
      ...r,
      fy_total: own.reduce((s, l) => s + Number(l.amount), 0),
      line_count: new Set(own.map((l) => rowKey(l))).size,
      changed_count: 0, // filled per-revision only in the detail view
      departments: Array.from(new Set(own.map((l) => l.department))).sort(),
    };
  });
}

/** ACCOUNTING gets history rows, not cell-level figures. */
export function canOpenRevisionDetail(viewer: CurrentUser, revision: BudgetRevision): boolean {
  if (isSuperadmin(viewer) || hasRole(viewer, "CEO")) return true;
  return viewer.email === revision.owner_email;
}

export function assertCanOpenDetail(viewer: CurrentUser, revision: BudgetRevision): void {
  if (!canOpenRevisionDetail(viewer, revision)) {
    throw new ForbiddenError(
      "Budget figures are visible to the owner and to CEO only. Accounting can see the revision history and export the audit trail.",
    );
  }
}

export { MONTHS };
