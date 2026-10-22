import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { listBranches } from "@/lib/branches";
import {
  BRANCH_SPLIT_DEPARTMENTS, SHARED_BRANCH, isBranchSplit, branchesForDepartment,
} from "@/lib/branches-shared";
import type { CurrentUser } from "@/types/database";

// Branch review: correcting which branch a request was filed against.
//
// ===========================================================================
// THIS CORRECTS ATTRIBUTION, NOT MONEY.
// ===========================================================================
// It writes requests.product (and the matching items_json entries) directly,
// with an audit row. It does NOT change status, does NOT reopen anything, and
// does NOT route through the edit-request approval flow. Most of these
// requests are PAID and must stay PAID — asking a CEO to re-approve a payment
// because somebody mistyped which store it belonged to would be ceremony, not
// control, and the approval it produced would be meaningless.
//
// Amounts are never writable here. The only field this module changes is the
// branch.
//
// ===========================================================================
// IT IS PERMANENT, NOT A BACKFILL TOOL.
// ===========================================================================
// It drains to empty once the existing unattributed requests are worked
// through, and then stays as the only way to correct a misfiled branch. That
// is why `reviewed: "all"` exists: without it this would be a queue that
// becomes useless the day it is finished.

export interface ReviewRow {
  request_id: string;
  department: string;
  status: string;
  total: number;
  budget_period: string | null;
  fiscal_year: number;
  description: string | null;
  requester_email: string;
  /** Current branch — null when nobody has recorded one. */
  branch: string | null;
  /** Per-item branches, when the request uses them. Read-only context. */
  itemBranches: string[];
  /** A store named in the free text. A HINT. Never applied automatically. */
  suggestion: string | null;
  suggestionReason: string | null;
}

export interface ReviewFilters {
  department?: string | null;
  fiscalYear?: number | null;
  /** "unreviewed" = no branch recorded. "all" = everything, for corrections. */
  reviewed?: "unreviewed" | "all";
}

/**
 * Which branch-split departments may this person review?
 *
 * SUPERADMIN: all of them. A BO: only the ones they own, because correcting
 * your own department's attribution is housekeeping and correcting someone
 * else's is editing their numbers. Anyone else: none.
 */
export async function reviewableDepartments(viewer: CurrentUser): Promise<string[]> {
  const all = [...BRANCH_SPLIT_DEPARTMENTS];
  if (isSuperadmin(viewer)) return all;
  if (!hasRole(viewer, "BO")) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("bo_scopes").select("dept_scope").eq("email", viewer.email);
  const scopes = (data ?? []).map((r) => String(r.dept_scope ?? ""));
  // '*' is unrestricted, same convention as every other scope column.
  if (scopes.some((s) => s.trim() === "*")) return all;
  const owned = new Set(
    scopes.flatMap((s) => s.split(",").map((d) => d.trim())).filter(Boolean),
  );
  return all.filter((d) => owned.has(d));
}

export function assertCanReview(viewer: CurrentUser, departments: string[]): void {
  if (departments.length === 0) {
    throw new ForbiddenError(
      "Branch review is for admins and the budget owner of a branch-split department.",
    );
  }
}

/**
 * A store named in the description.
 *
 * ===========================================================================
 * A SUGGESTION IS A HINT AND IS NEVER APPLIED AUTOMATICALLY.
 * ===========================================================================
 * A store named in free text is a clue, not a fact: "ค่าส่งของไป Song Wat"
 * might be a delivery TO Song Wat paid centrally, or Song Wat's own cost. The
 * text cannot tell the difference and neither can this function. It exists to
 * save typing, and a human confirms every one.
 *
 * Matching is on the normalised name and requires the whole name to appear,
 * so "Loft" does not match "Loft eyes". Shared is suggested from the words
 * that actually mean it rather than from a store name.
 */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]/g, "");

const SHARED_HINTS = [
  "allbranch", "everybranch", "ทุกสาขา", "ทุกสาขาa",
  "uniform", "ยูนิฟอร์ม", "เดินทางไปสาขา",
];

export function suggestBranch(
  description: string | null,
  itemsSummary: string | null,
  branchNames: string[],
): { suggestion: string | null; reason: string | null } {
  const text = norm(`${description ?? ""} ${itemsSummary ?? ""}`);
  if (!text) return { suggestion: null, reason: null };

  // Longest first, so "Loft eyes-Thong Lor" wins over "Loft eyes".
  const byLength = [...branchNames].sort((a, b) => norm(b).length - norm(a).length);
  for (const name of byLength) {
    const n = norm(name);
    if (n.length >= 4 && text.includes(n)) {
      return { suggestion: name, reason: `the description mentions “${name}”` };
    }
  }
  for (const hint of SHARED_HINTS) {
    if (text.includes(norm(hint))) {
      return {
        suggestion: SHARED_BRANCH,
        reason: `the description reads like a cost shared across branches (“${hint}”)`,
      };
    }
  }
  return { suggestion: null, reason: null };
}

const fiscalYearOf = (r: { budget_period: string | null; timestamp: string }) => {
  const m = /^(\d{4})-(\d{2})$/.exec(r.budget_period ?? "");
  return m ? Number(m[1]) : new Date(r.timestamp).getFullYear();
};

export async function listForReview(
  viewer: CurrentUser, filters: ReviewFilters,
): Promise<{ rows: ReviewRow[]; departments: string[]; branchOptions: Record<string, string[]> }> {
  const departments = await reviewableDepartments(viewer);
  assertCanReview(viewer, departments);

  const wanted = filters.department && departments.includes(filters.department)
    ? [filters.department]
    : departments;

  const admin = createAdminClient();
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("requests")
      .select("request_id, department, status, total, budget_period, timestamp, description, items_summary, requester_email, product, items_json")
      .in("department", wanted)
      .order("timestamp", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  // The option list per department, so the dropdown offers what the submit
  // form would have offered — one definition, not a second copy.
  const all = await listBranches();
  const branchOptions: Record<string, string[]> = {};
  for (const d of departments) {
    branchOptions[d] = [
      SHARED_BRANCH,
      ...branchesForDepartment(all, d).map((b) => b.name),
    ];
  }
  const everyName = Array.from(new Set(Object.values(branchOptions).flat()))
    .filter((n) => n !== SHARED_BRANCH);

  // THE EX-"All branch" REQUESTS, from the audit log rather than from their
  // text. Migration 059 mapped thirteen requests from "All branch" to no
  // branch because Shared did not exist yet; "All branch" is precisely what
  // Shared means, so the log records the answer directly.
  //
  // It is still only a SUGGESTION. The rule that a suggestion is never
  // applied automatically does not bend because this evidence is better than
  // a description — and a human confirming thirteen rows with one bulk apply
  // costs a minute.
  const exAllBranch = new Set<string>();
  {
    const { data } = await admin
      .from("audit_log").select("request_id, detail_json")
      .eq("action", "REQUEST_BRANCH_RENAMED");
    for (const a of data ?? []) {
      const d = a.detail_json as { from?: string } | null;
      if (d?.from === "All branch" && a.request_id) exAllBranch.add(a.request_id as string);
    }
  }

  const rows: ReviewRow[] = [];
  for (const r of out as never as (ReviewRow & {
    product: string | null; items_json: unknown; items_summary: string | null; timestamp: string;
  })[]) {
    const fy = fiscalYearOf(r);
    if (filters.fiscalYear && fy !== filters.fiscalYear) continue;

    const items = Array.isArray(r.items_json) ? (r.items_json as { product?: string }[]) : [];
    const itemBranches = Array.from(new Set(
      items.map((i) => String(i?.product ?? "").trim()).filter(Boolean),
    ));
    const branch = (r.product ?? "").trim() || null;

    // "Reviewed" means a branch is recorded, at header or item level. It is
    // deliberately not a separate flag: a flag would let a row be marked done
    // while still carrying no branch, which is the state this screen exists
    // to remove.
    const hasBranch = !!branch || itemBranches.length > 0;
    if ((filters.reviewed ?? "unreviewed") === "unreviewed" && hasBranch) continue;

    const { suggestion, reason } = hasBranch
      ? { suggestion: null, reason: null }
      : exAllBranch.has(r.request_id)
        ? {
            suggestion: SHARED_BRANCH,
            reason: "it was filed as “All branch” before Shared existed (migration 059)",
          }
        : suggestBranch(r.description, r.items_summary, everyName);

    rows.push({
      request_id: r.request_id, department: r.department, status: r.status,
      total: Number(r.total) || 0, budget_period: r.budget_period, fiscal_year: fy,
      description: r.description, requester_email: r.requester_email,
      branch, itemBranches, suggestion, suggestionReason: reason,
    });
  }
  return { rows, departments, branchOptions };
}

export interface BranchAssignment { request_id: string; branch: string }

/**
 * Write the branch. Header AND items_json, because v_request_spend reads the
 * ITEM's product with the header only as a fallback — the lesson migration
 * 043 recorded and 059 repeated.
 */
export async function saveBranches(
  viewer: CurrentUser, assignments: BranchAssignment[],
): Promise<{ updated: number }> {
  const departments = await reviewableDepartments(viewer);
  assertCanReview(viewer, departments);
  if (assignments.length === 0) return { updated: 0 };

  const admin = createAdminClient();
  const ids = assignments.map((a) => a.request_id);
  const { data: existing, error } = await admin
    .from("requests")
    .select("request_id, department, status, product, items_json")
    .in("request_id", ids);
  if (error) throw error;

  const byId = new Map((existing ?? []).map((r) => [r.request_id as string, r]));

  // Every target must be in a department this person may review, and in a
  // branch-split one at all. Checked per row rather than once: a bulk
  // "set selected to…" is exactly where a row from another department would
  // otherwise slip through.
  for (const a of assignments) {
    const row = byId.get(a.request_id);
    if (!row) throw new ForbiddenError(`${a.request_id} not found.`);
    if (!isBranchSplit(row.department as string)) {
      throw new ForbiddenError(`${a.request_id} is in ${row.department}, which is not branch-split.`);
    }
    if (!departments.includes(row.department as string)) {
      throw new ForbiddenError(
        `${a.request_id} belongs to ${row.department}, which you do not own.`,
      );
    }
    const valid = [SHARED_BRANCH, ...branchesForDepartment(await listBranches(), row.department as string).map((b) => b.name)];
    if (!valid.includes(a.branch)) {
      throw new ForbiddenError(`"${a.branch}" is not a branch available to ${row.department}.`);
    }
  }

  let updated = 0;
  for (const a of assignments) {
    const row = byId.get(a.request_id)!;
    const before = (row.product as string | null) ?? null;
    if (before === a.branch) continue;

    const items = Array.isArray(row.items_json) ? (row.items_json as Record<string, unknown>[]) : null;
    // Only items that have no branch of their own, or that carried the same
    // stale value as the header. An item deliberately naming a different
    // store is left alone — a per-item branch is a finer answer than the
    // header's and this screen must not flatten it.
    const nextItems = items?.map((i) => {
      const cur = String(i?.product ?? "").trim();
      return cur === "" || cur === (before ?? "") ? { ...i, product: a.branch } : i;
    }) ?? null;

    const patch: Record<string, unknown> = { product: a.branch, updated_at: new Date().toISOString() };
    if (nextItems) patch.items_json = nextItems;

    const { error: upErr } = await admin.from("requests").update(patch).eq("request_id", a.request_id);
    if (upErr) throw upErr;

    await logAudit(viewer.email, a.request_id, "REQUEST_BRANCH_REVIEWED", {
      field: "product (header and items_json)",
      from: before,
      to: a.branch,
      department: row.department,
      // Recorded explicitly so the log answers "did this change the money?"
      // without the reader having to know how this screen works.
      status_unchanged: row.status,
      amount_unchanged: true,
      via: "branch review screen",
    });
    updated++;
  }
  return { updated };
}
