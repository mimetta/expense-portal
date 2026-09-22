import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { boScopeMatchesRequest } from "@/lib/scope-match";
import { isBoActionable, isCeoActionable, isPettyCashApprovable } from "@/lib/status";
import { PETTY_CASH_LABEL } from "@/lib/constants";
import type { ExpenseRequest, RoleRow } from "@/types/database";

// Deactivate / reactivate / delete a person.
//
// Deletion is deliberately near-impossible: lib/auth.ts auto-registers any
// @mimetta.co address on sign-in, so deleting someone who still works here
// just loses their record and re-creates them blank on their next visit.
// Deletion exists only to undo a mis-typed "+ Add person".

async function assertAdmin() {
  const user = await requireUser();
  if (!isSuperadmin(user)) throw new ForbiddenError("Only an admin can deactivate or delete a person.");
  return user;
}

export interface Consequences {
  unownedBudgetLines: { bu: string; department: string; cat_l1: string }[];
  openRevisions: { fiscal_year: number; revision_no: number; status: string }[];
  stalledRequests: { request_id: string; stage: string; total: number }[];
  pettyCashFloats: { name: string; balance: number | null }[];
  historyCount: { requests: number; approvals: number; revisions: number; audit: number };
  canHardDelete: boolean;
}

/**
 * Everything that breaks if this person goes away. Shown in full BEFORE the
 * confirm, because "are you sure?" without the consequences is not a
 * decision.
 */
async function consequencesFor(email: string): Promise<Consequences> {
  const admin = createAdminClient();

  const [{ data: myScopes }, { data: otherScopes }, { data: cats }] = await Promise.all([
    admin.from("bo_scopes").select("bu_scope, dept_scope, cat_l1_scope").eq("email", email),
    admin.from("bo_scopes").select("bu_scope, dept_scope, cat_l1_scope").neq("email", email),
    admin.from("categories").select("bu, department, cat_l1"),
  ]);

  // Same matcher as check:bo-coverage — a line becomes unowned if this
  // person covers it and nobody else does.
  const unowned: Consequences["unownedBudgetLines"] = [];
  for (const c of cats ?? []) {
    if (!c.cat_l1) continue;
    const line = { bu: c.bu, department: c.department, cat_l1: c.cat_l1 } as unknown as ExpenseRequest;
    const mine = (myScopes ?? []).some((s) => boScopeMatchesRequest(s as unknown as RoleRow, line));
    if (!mine) continue;
    const other = (otherScopes ?? []).some((s) => boScopeMatchesRequest(s as unknown as RoleRow, line));
    if (!other) unowned.push({ bu: String(c.bu), department: String(c.department), cat_l1: String(c.cat_l1) });
  }

  const { data: revisions } = await admin
    .from("budget_revisions").select("fiscal_year, revision_no, status")
    .eq("owner_email", email).in("status", ["DRAFT", "SUBMITTED"]);

  // Requests waiting on THIS person specifically.
  const reqs: ExpenseRequest[] = [];
  for (let f = 0; ; f += 1000) {
    // Named columns, NOT select("*"): the full row drags items_json and
    // files_json along, which made this dialog take 8s over 1,166 requests.
    const { data } = await admin
      .from("requests")
      .select(
        "request_id, total, status, expense_type, skip_bo, bu, department, cat_l1, " +
        "requester_email, bo_approver, ceo_approver, accounting_user, " +
        "petty_cash_holder_email, petty_cash_approved_by",
      )
      .range(f, f + 999);
    reqs.push(...((data ?? []) as unknown as ExpenseRequest[]));
    if ((data ?? []).length < 1000) break;
  }
  const { data: roles } = await admin.from("person_roles").select("role").eq("email", email);
  const has = (r: string) => (roles ?? []).some((x) => x.role === r);

  const stalled: Consequences["stalledRequests"] = [];
  for (const r of reqs) {
    if (has("BO") && isBoActionable(r) && (myScopes ?? []).some((s) => boScopeMatchesRequest(s as unknown as RoleRow, r))) {
      stalled.push({ request_id: r.request_id, stage: "BO approval", total: Number(r.total ?? 0) });
    } else if (has("CEO") && isCeoActionable(r)) {
      stalled.push({ request_id: r.request_id, stage: "CEO approval", total: Number(r.total ?? 0) });
    } else if (
      has("PETTY_CASH_CUSTODIAN") && r.expense_type === PETTY_CASH_LABEL &&
      isPettyCashApprovable(r) && r.petty_cash_holder_email === email
    ) {
      stalled.push({ request_id: r.request_id, stage: "petty cash sign-off", total: Number(r.total ?? 0) });
    }
  }

  const { data: floats } = await admin
    .from("petty_cash_custodians").select("name, balance").eq("email", email);

  const mine = reqs.filter((r) => r.requester_email === email).length;
  const approvals = reqs.filter(
    (r) => r.bo_approver === email || r.ceo_approver === email ||
           r.accounting_user === email || r.petty_cash_approved_by === email,
  ).length;
  const { count: revCount } = await admin
    .from("budget_revisions").select("*", { count: "exact", head: true }).eq("owner_email", email);
  const { count: auditCount } = await admin
    .from("audit_log").select("*", { count: "exact", head: true }).eq("actor_email", email);

  const history = { requests: mine, approvals, revisions: revCount ?? 0, audit: auditCount ?? 0 };
  return {
    unownedBudgetLines: unowned,
    openRevisions: (revisions ?? []) as Consequences["openRevisions"],
    stalledRequests: stalled,
    pettyCashFloats: (floats ?? []) as Consequences["pettyCashFloats"],
    historyCount: history,
    // "Zero history" means nothing anywhere references them except the audit
    // rows for their own creation.
    canHardDelete: history.requests === 0 && history.approvals === 0 && history.revisions === 0 && history.audit <= 2,
  };
}

// GET ?email= — the consequences, for the confirm dialog.
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
    const email = new URL(req.url).searchParams.get("email");
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
    return NextResponse.json(await consequencesFor(email));
  } catch (err) {
    return handleApiError(err);
  }
}

// POST { email, action: "deactivate" | "reactivate" | "delete" }
export async function POST(req: NextRequest) {
  try {
    const actor = await assertAdmin();
    const { email: raw, action } = (await req.json()) as { email?: string; action?: string };
    const email = String(raw ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: person } = await admin.from("people").select("*").eq("email", email).maybeSingle();
    if (!person) return NextResponse.json({ error: `${email} does not exist` }, { status: 404 });

    if (action === "deactivate" || action === "delete") {
      // Same lockout rules as the SUPERADMIN role, applied to the whole
      // person: removing the account is at least as final as removing the role.
      if (email === actor.email) {
        throw new ForbiddenError(
          action === "delete"
            ? "You cannot delete your own account."
            : "You cannot deactivate yourself. Ask another admin, so a mistake here cannot lock you out.",
        );
      }
      const { data: superRows } = await admin.from("person_roles").select("email").eq("role", "SUPERADMIN");
      const { data: allPeople } = await admin.from("people").select("email, active");
      const activeSupers = (superRows ?? [])
        .map((r) => r.email as string)
        .filter((e) => (allPeople ?? []).find((p) => p.email === e)?.active !== false);
      if (activeSupers.includes(email) && activeSupers.length <= 1) {
        throw new ConflictError(
          "This is the last active SUPERADMIN. Deactivating them would leave nobody able to manage users or access.",
        );
      }
    }

    if (action === "deactivate") {
      const { error } = await admin.from("people").update({
        active: false, deactivated_at: new Date().toISOString(), deactivated_by: actor.email,
        updated_at: new Date().toISOString(),
      }).eq("email", email);
      if (error) throw error;
      const c = await consequencesFor(email);
      await logAudit(actor.email, null, "PERSON_DEACTIVATED", {
        email,
        consequences: {
          unowned_budget_lines: c.unownedBudgetLines.length,
          open_revisions: c.openRevisions.length,
          stalled_requests: c.stalledRequests.map((s) => s.request_id),
          petty_cash_floats: c.pettyCashFloats.length,
        },
      });
      return NextResponse.json({ ok: true, action: "deactivated" });
    }

    if (action === "reactivate") {
      const { error } = await admin.from("people").update({
        active: true, deactivated_at: null, deactivated_by: null,
        updated_at: new Date().toISOString(),
      }).eq("email", email);
      if (error) throw error;
      await logAudit(actor.email, null, "PERSON_REACTIVATED", { email });
      return NextResponse.json({ ok: true, action: "reactivated" });
    }

    if (action === "delete") {
      const c = await consequencesFor(email);
      if (!c.canHardDelete) {
        throw new ConflictError(
          `${email} has history and cannot be deleted — ${c.historyCount.requests} request(s), ` +
            `${c.historyCount.approvals} approval(s), ${c.historyCount.revisions} budget revision(s), ` +
            `${c.historyCount.audit} audit entries. Deactivate instead: deleting would leave those rows ` +
            `pointing at a person who no longer exists, and auth would re-create them on their next sign-in.`,
        );
      }
      // person_roles / bo_scopes / person_menu_overrides cascade from people.
      const { error } = await admin.from("people").delete().eq("email", email);
      if (error) throw error;
      await logAudit(actor.email, null, "PERSON_DELETED", { email, history: c.historyCount });
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    return NextResponse.json({ error: 'action must be "deactivate", "reactivate" or "delete"' }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
