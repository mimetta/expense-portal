import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import { ConflictError, NotFoundError } from "@/lib/request-repo";
import { boScopeMatchesRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { CurrentUser, ExpenseRequest, RoleRow } from "@/types/database";

// Budget revision state machine. SERVER-SIDE ONLY — every function here holds
// the service-role key via createAdminClient(), so nothing in this file may be
// imported from a Client Component.
//
// A revision belongs to a BUDGET OWNER, not a segment. BO scope
// (bu_scope, dept_scope, cat_l1_scope) cross-cuts departments, so one
// owner's revision can span several segments and one segment's budget is
// assembled from several owners' revisions. See migration 028's header.
//
// Every transition re-reads the row, re-checks permission and re-validates
// the CURRENT status server-side before writing. A status supplied by a
// caller is never trusted — it is not even a parameter.

export type RevisionStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export interface BudgetRevision {
  id: string;
  owner_email: string;
  fiscal_year: number;
  revision_no: number;
  status: RevisionStatus;
  created_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id?: string;
  revision_id?: string;
  bu: string;
  department: string;
  cat_l1: string;
  cat_l2: string | null;
  month: number;
  amount: number;
}

/** A line's identity, ignoring amount. */
export type LineKey = Pick<BudgetLine, "bu" | "department" | "cat_l1" | "cat_l2" | "month">;

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const lineKey = (l: LineKey) =>
  `${l.bu}|${l.department}|${l.cat_l1}|${l.cat_l2 ?? ""}|${l.month}`;
const dimKey = (l: { bu: string; department: string; cat_l1: string; cat_l2: string | null }) =>
  `${l.bu}|${l.department}|${l.cat_l1}|${l.cat_l2 ?? ""}`;

// --- scope ------------------------------------------------------------------

/**
 * The owner's BO scope rows. Scope is matched with the EXISTING
 * boScopeMatchesRequest helper — the same one /bo-approvals and
 * lib/spend.ts use — never a second copy of the comma/wildcard rules. It
 * takes an ExpenseRequest but reads only bu/department/cat_l1, so a
 * three-field dimension object is passed through it, exactly as
 * lib/spend.ts#scopeFilter already does.
 */
async function scopeRowsFor(ownerEmail: string): Promise<RoleRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .select("id, email, role, bu_scope, dept_scope, cat_l1_scope, created_at, is_auto_registered, chapter")
    .eq("email", ownerEmail)
    .eq("role", "BO");
  if (error) throw error;
  return (data ?? []) as RoleRow[];
}

/** ORs across the owner's BO rows — a line is in scope if ANY row matches. */
function inScope(scopes: RoleRow[], dim: { bu: string; department: string; cat_l1: string }): boolean {
  return scopes.some((s) =>
    boScopeMatchesRequest(s, {
      bu: dim.bu,
      department: dim.department,
      cat_l1: dim.cat_l1,
    } as unknown as ExpenseRequest),
  );
}

// --- guards -----------------------------------------------------------------

function assertCanActForOwner(viewer: CurrentUser, ownerEmail: string): void {
  if (isSuperadmin(viewer)) return;
  if (viewer.email !== ownerEmail) {
    throw new ForbiddenError("You can only work on your own budget revision.");
  }
  if (!hasRole(viewer, "BO")) {
    throw new ForbiddenError("Only a budget owner can raise a budget revision.");
  }
}

function assertCeo(viewer: CurrentUser): void {
  if (isSuperadmin(viewer) || hasRole(viewer, "CEO")) return;
  throw new ForbiddenError("Only a CEO can approve or reject a budget revision.");
}

async function getRevisionRow(revisionId: string): Promise<BudgetRevision> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_revisions")
    .select("*")
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Budget revision not found");
  return data as BudgetRevision;
}

/**
 * Every line must correspond to a real `categories` row. This CANNOT be a
 * foreign key — categories has no unique constraint on the natural key and
 * cat_l2 is nullable, so uniqueness would need coalesce(), which an FK cannot
 * reference (see migration 028's header). Enforced here instead, on both
 * createDraft (which only seeds from categories anyway) and saveDraft.
 */
async function assertLinesAreRealCategories(lines: LineKey[]): Promise<void> {
  if (lines.length === 0) return;
  const admin = createAdminClient();
  const { data, error } = await admin.from("categories").select("bu, department, cat_l1, cat_l2");
  if (error) throw error;
  const known = new Set((data ?? []).map((c) => dimKey(c as never)));
  const bad = lines.filter((l) => !known.has(dimKey(l)));
  if (bad.length > 0) {
    const shown = bad.slice(0, 3).map((b) => `${b.bu} / ${b.department} / ${b.cat_l1} / ${b.cat_l2 ?? "—"}`);
    throw new ConflictError(
      `${bad.length} budget line(s) do not match any category: ${shown.join("; ")}${bad.length > 3 ? ", …" : ""}. Add the category in Settings first.`,
    );
  }
}

/**
 * OVERLAP CHECK. Enumerated cat_l1 scopes make overlap detectable but not
 * impossible — two BOs can still both match a line (that is exactly what
 * migration 021 had to unpick for HR Salary). If it happened here, two
 * revisions would each claim the same cell and v_budget_current would
 * silently resolve it last-approved-wins, with no indication anywhere that a
 * figure had been overwritten by someone else's revision. So it refuses, and
 * names the other owner.
 *
 * Run at BOTH createDraft and approveRevision: scopes can be widened between
 * the two, so passing at creation does not mean still passing at approval.
 */
async function assertNoScopeOverlap(ownerEmail: string, dims: LineKey[]): Promise<void> {
  if (dims.length === 0) return;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .select("id, email, role, bu_scope, dept_scope, cat_l1_scope, created_at, is_auto_registered, chapter")
    .eq("role", "BO")
    .neq("email", ownerEmail);
  if (error) throw error;
  const others = (data ?? []) as RoleRow[];

  const clashes: string[] = [];
  const seen = new Set<string>();
  for (const d of dims) {
    const k = dimKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const o of others) {
      if (inScope([o], d)) {
        clashes.push(`${d.bu} / ${d.department} / ${d.cat_l1} — also in ${o.email}'s scope`);
        break;
      }
    }
  }
  if (clashes.length > 0) {
    throw new ConflictError(
      `${clashes.length} line(s) are claimed by more than one budget owner, so approving this revision could silently overwrite another owner's figures. Narrow the overlapping scope first.\n` +
        clashes.slice(0, 5).join("\n") +
        (clashes.length > 5 ? `\n…and ${clashes.length - 5} more` : ""),
    );
  }
}

// --- transitions ------------------------------------------------------------

/**
 * Seeds a DRAFT with one line per (bu, department, cat_l1, cat_l2) in the
 * owner's scope × 12 months, carrying forward whatever is currently approved
 * for that line and 0 where nothing is.
 *
 * The partial unique index one_draft_per_owner means a second concurrent
 * createDraft raises a unique violation rather than producing two drafts.
 */
export async function createDraft(
  ownerEmail: string,
  fiscalYear: number,
  viewer: CurrentUser,
): Promise<{ revision: BudgetRevision; lines: number }> {
  assertCanActForOwner(viewer, ownerEmail);

  const admin = createAdminClient();
  const scopes = await scopeRowsFor(ownerEmail);
  if (scopes.length === 0) {
    throw new ForbiddenError(`${ownerEmail} holds no BO scope, so there is nothing to budget.`);
  }

  const { data: cats, error: catErr } = await admin
    .from("categories")
    .select("bu, department, cat_l1, cat_l2");
  if (catErr) throw catErr;

  const dims = (cats ?? [])
    .filter((c) => c.cat_l1 && inScope(scopes, c as never))
    .map((c) => ({
      bu: c.bu as string,
      department: c.department as string,
      cat_l1: c.cat_l1 as string,
      cat_l2: (c.cat_l2 as string | null) ?? "",
    }));
  if (dims.length === 0) {
    throw new ConflictError(
      `No category lines fall inside ${ownerEmail}'s BO scope, so a draft would be empty.`,
    );
  }

  await assertNoScopeOverlap(
    ownerEmail,
    dims.map((d) => ({ ...d, month: 1 })),
  );

  // Carry forward the currently-approved figure per line.
  const { data: current, error: curErr } = await admin
    .from("v_budget_current")
    .select("bu, department, cat_l1, cat_l2, month, amount")
    .eq("fiscal_year", fiscalYear);
  if (curErr) throw curErr;
  const carried = new Map<string, number>();
  for (const c of current ?? []) carried.set(lineKey(c as never), Number(c.amount));

  const { data: prior, error: priorErr } = await admin
    .from("budget_revisions")
    .select("revision_no")
    .eq("owner_email", ownerEmail)
    .eq("fiscal_year", fiscalYear)
    .order("revision_no", { ascending: false })
    .limit(1);
  if (priorErr) throw priorErr;
  const nextNo = (prior?.[0]?.revision_no ?? 0) + 1;

  const { data: revRow, error: revErr } = await admin
    .from("budget_revisions")
    .insert({
      owner_email: ownerEmail,
      fiscal_year: fiscalYear,
      revision_no: nextNo,
      status: "DRAFT",
      created_by: viewer.email,
    })
    .select("*")
    .single();
  if (revErr) throw revErr;
  const revision = revRow as BudgetRevision;

  const rows = dims.flatMap((d) =>
    MONTHS.map((m) => ({
      revision_id: revision.id,
      bu: d.bu,
      department: d.department,
      cat_l1: d.cat_l1,
      cat_l2: d.cat_l2 ?? "",
      month: m,
      amount: carried.get(lineKey({ ...d, month: m })) ?? 0,
    })),
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("budget_lines").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }

  await logAudit(viewer.email, null, "BUDGET_DRAFT_CREATED", {
    revision_id: revision.id,
    owner_email: ownerEmail,
    fiscal_year: fiscalYear,
    revision_no: nextNo,
    lines: rows.length,
    on_behalf_of: viewer.email !== ownerEmail ? ownerEmail : undefined,
  });

  return { revision, lines: rows.length };
}

/**
 * DRAFT only. A line outside the owner's CURRENT scope is REFUSED — the whole
 * save fails and names the offender — rather than being silently dropped,
 * which would look to the BO like their figure had saved.
 */
export async function saveDraft(
  revisionId: string,
  lines: BudgetLine[],
  viewer: CurrentUser,
): Promise<{ updated: number }> {
  const revision = await getRevisionRow(revisionId);
  assertCanActForOwner(viewer, revision.owner_email);
  if (revision.status !== "DRAFT") {
    throw new ConflictError(`Revision is ${revision.status}, not DRAFT — it can no longer be edited.`);
  }

  const scopes = await scopeRowsFor(revision.owner_email);
  const outOfScope = lines.filter((l) => !inScope(scopes, l));
  if (outOfScope.length > 0) {
    const shown = outOfScope.slice(0, 3).map((l) => `${l.bu} / ${l.department} / ${l.cat_l1}`);
    throw new ForbiddenError(
      `${outOfScope.length} line(s) fall outside ${revision.owner_email}'s budget scope and were not saved: ${shown.join("; ")}${outOfScope.length > 3 ? ", …" : ""}`,
    );
  }
  await assertLinesAreRealCategories(lines);

  const admin = createAdminClient();
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500).map((l) => ({
      revision_id: revisionId,
      bu: l.bu,
      department: l.department,
      cat_l1: l.cat_l1,
      // cat_l2 is NOT NULL DEFAULT '' since migration 029 (a nullable
      // column cannot arbitrate ON CONFLICT). Normalise here so callers may
      // still pass null.
      cat_l2: l.cat_l2 ?? "",
      month: l.month,
      amount: l.amount,
    }));
    const { error } = await admin
      .from("budget_lines")
      .upsert(chunk, { onConflict: "revision_id,bu,department,cat_l1,cat_l2,month" });
    if (error) throw error;
  }

  const { error: touchErr } = await admin
    .from("budget_revisions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", revisionId);
  if (touchErr) throw touchErr;

  await logAudit(viewer.email, null, "BUDGET_DRAFT_SAVED", {
    revision_id: revisionId,
    owner_email: revision.owner_email,
    lines: lines.length,
  });
  return { updated: lines.length };
}

/** DRAFT -> SUBMITTED. */
export async function submitForApproval(
  revisionId: string,
  viewer: CurrentUser,
): Promise<BudgetRevision> {
  const revision = await getRevisionRow(revisionId);
  assertCanActForOwner(viewer, revision.owner_email);
  if (revision.status !== "DRAFT") {
    throw new ConflictError(`Only a DRAFT can be submitted; this revision is ${revision.status}.`);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("budget_revisions")
    .update({ status: "SUBMITTED", submitted_by: viewer.email, submitted_at: now, updated_at: now })
    .eq("id", revisionId)
    .eq("status", "DRAFT") // optimistic guard: lost race -> 0 rows, not a silent overwrite
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ConflictError("Revision changed status while submitting — reload and retry.");

  await logAudit(viewer.email, null, "BUDGET_SUBMITTED", {
    revision_id: revisionId,
    owner_email: revision.owner_email,
    revision_no: revision.revision_no,
  });
  return data as BudgetRevision;
}

/**
 * SUBMITTED -> APPROVED. CEO only, never the submitter, and the owner's prior
 * APPROVED revisions are marked SUPERSEDED.
 *
 * Note SUPERSEDED is bookkeeping, not the mechanism: v_budget_current already
 * resolves per line by approved_at, so a stale revision stops winning the
 * moment a newer one covering the same line is approved. Marking it keeps the
 * history readable.
 */
export async function approveRevision(
  revisionId: string,
  viewer: CurrentUser,
): Promise<BudgetRevision> {
  assertCeo(viewer);
  const revision = await getRevisionRow(revisionId);
  if (revision.status !== "SUBMITTED") {
    throw new ConflictError(`Only a SUBMITTED revision can be approved; this one is ${revision.status}.`);
  }
  if (revision.submitted_by && revision.submitted_by === viewer.email) {
    throw new ForbiddenError(
      "You submitted this revision, so you cannot approve it. Another CEO must act on it.",
    );
  }

  const admin = createAdminClient();
  const { data: lines, error: lineErr } = await admin
    .from("budget_lines")
    .select("bu, department, cat_l1, cat_l2, month")
    .eq("revision_id", revisionId);
  if (lineErr) throw lineErr;
  // Re-checked here, not only at createDraft: a scope widened in between could
  // have introduced an overlap since.
  await assertNoScopeOverlap(revision.owner_email, (lines ?? []) as LineKey[]);

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("budget_revisions")
    .update({ status: "APPROVED", approved_by: viewer.email, approved_at: now, updated_at: now })
    .eq("id", revisionId)
    .eq("status", "SUBMITTED")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ConflictError("Revision changed status while approving — reload and retry.");

  const { error: supErr } = await admin
    .from("budget_revisions")
    .update({ status: "SUPERSEDED", updated_at: now })
    .eq("owner_email", revision.owner_email)
    .eq("fiscal_year", revision.fiscal_year)
    .eq("status", "APPROVED")
    .neq("id", revisionId);
  if (supErr) throw supErr;

  await logAudit(viewer.email, null, "BUDGET_APPROVED", {
    revision_id: revisionId,
    owner_email: revision.owner_email,
    revision_no: revision.revision_no,
    submitted_by: revision.submitted_by,
  });
  return data as BudgetRevision;
}

/** SUBMITTED -> DRAFT. CEO only, note required, lines left untouched. */
export async function rejectRevision(
  revisionId: string,
  note: string,
  viewer: CurrentUser,
): Promise<BudgetRevision> {
  assertCeo(viewer);
  if (!note?.trim()) {
    throw new ConflictError("A note is required when requesting changes — it is what the owner amends against.");
  }
  const revision = await getRevisionRow(revisionId);
  if (revision.status !== "SUBMITTED") {
    throw new ConflictError(`Only a SUBMITTED revision can be rejected; this one is ${revision.status}.`);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  // Returns to DRAFT, not REJECTED: the owner amends the same figures rather
  // than retyping them. rejected_by/at/note record that it happened.
  const { data, error } = await admin
    .from("budget_revisions")
    .update({
      status: "DRAFT",
      rejected_by: viewer.email,
      rejected_at: now,
      note: note.trim(),
      submitted_by: null,
      submitted_at: null,
      updated_at: now,
    })
    .eq("id", revisionId)
    .eq("status", "SUBMITTED")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ConflictError("Revision changed status while rejecting — reload and retry.");

  await logAudit(viewer.email, null, "BUDGET_REJECTED", {
    revision_id: revisionId,
    owner_email: revision.owner_email,
    revision_no: revision.revision_no,
    note: note.trim(),
  });
  return data as BudgetRevision;
}

// --- reads ------------------------------------------------------------------

export async function getRevision(
  revisionId: string,
  viewer: CurrentUser,
): Promise<{ revision: BudgetRevision; lines: BudgetLine[] }> {
  const revision = await getRevisionRow(revisionId);
  const mayRead =
    isSuperadmin(viewer) ||
    hasRole(viewer, "CEO") ||
    hasRole(viewer, "ACCOUNTING") ||
    viewer.email === revision.owner_email;
  if (!mayRead) throw new ForbiddenError("You cannot view this budget revision.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_lines")
    .select("id, revision_id, bu, department, cat_l1, cat_l2, month, amount")
    .eq("revision_id", revisionId)
    .order("bu")
    .order("department")
    .order("cat_l1")
    .order("month");
  if (error) throw error;
  return { revision, lines: (data ?? []) as BudgetLine[] };
}

/** A BO sees only their own; CEO/ACCOUNTING/SUPERADMIN see every owner's. */
export async function listRevisions(
  viewer: CurrentUser,
  opts: { fiscalYear?: number; ownerEmail?: string } = {},
): Promise<BudgetRevision[]> {
  const admin = createAdminClient();
  let q = admin.from("budget_revisions").select("*").order("fiscal_year", { ascending: false }).order("revision_no", { ascending: false });
  if (opts.fiscalYear) q = q.eq("fiscal_year", opts.fiscalYear);

  const seesAll = isSuperadmin(viewer) || hasRole(viewer, "CEO") || hasRole(viewer, "ACCOUNTING");
  if (!seesAll) {
    if (!hasRole(viewer, "BO")) return [];
    q = q.eq("owner_email", viewer.email);
  } else if (opts.ownerEmail) {
    q = q.eq("owner_email", opts.ownerEmail);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BudgetRevision[];
}

/** Owners whose BO scope covers at least one category line — the candidates. */
export async function listBudgetOwners(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("roles").select("email").eq("role", "BO");
  if (error) throw error;
  // Array.from, not [...Set] — this tsconfig targets below es2015 for
  // iteration (see commit 6fa230f, same fix).
  return Array.from(new Set((data ?? []).map((r) => r.email as string))).sort();
}
