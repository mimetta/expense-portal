import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { isAccountingActionable, isBoActionable, isCeoActionable } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

// Homepage Quick Stats. "Pending My Approval" sums whichever of BO/CEO/
// ACCOUNTING the user actually holds (SUPERADMIN counts as all three,
// consistent with its full-access convention elsewhere) — Procurement is
// deliberately excluded, per the spec's own wording for this stat.
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    const { data, error } = await admin.from("requests").select("*");
    if (error) throw error;
    const all = (data ?? []) as ExpenseRequest[];

    const myPending = all.filter(
      (r) => r.requester_email === user.email && r.status !== "PAID" && r.status !== "REJECTED",
    ).length;

    const actsAsBo = isSuperadmin(user) || hasRole(user, "BO");
    const actsAsCeo = isSuperadmin(user) || hasRole(user, "CEO");
    const actsAsAccounting = isSuperadmin(user) || hasRole(user, "ACCOUNTING");

    // "/" is just an internal sentinel meaning "no real link picked yet" —
    // this only ever reaches the client when pendingMyApprovalRelevant is
    // also false, in which case the homepage doesn't render this card at
    // all (see CLAUDE.md "Homepage"), so it's never actually shown as a
    // link. Was "/dashboard" before Dashboard was removed from the nav.
    let pendingMyApproval = 0;
    let approvalLink = "/";
    if (actsAsBo) {
      pendingMyApproval += all.filter((r) => isBoActionable(r) && canBoActOnRequest(user, r)).length;
      approvalLink = "/bo-approvals";
    }
    if (actsAsCeo) {
      pendingMyApproval += all.filter((r) => isCeoActionable(r)).length;
      if (approvalLink === "/") approvalLink = "/ceo-approvals";
    }
    if (actsAsAccounting) {
      pendingMyApproval += all.filter((r) => isAccountingActionable(r)).length;
      if (approvalLink === "/") approvalLink = "/accounting";
    }

    const now = new Date();
    const paidThisMonth = all
      .filter((r) => {
        if (r.status !== "PAID" || !r.paid_at) return false;
        const paidAt = new Date(r.paid_at);
        return paidAt.getFullYear() === now.getFullYear() && paidAt.getMonth() === now.getMonth();
      })
      .reduce((sum, r) => sum + r.total, 0);

    return NextResponse.json({
      myPending,
      pendingMyApproval,
      pendingMyApprovalRelevant: actsAsBo || actsAsCeo || actsAsAccounting,
      approvalLink,
      paidThisMonth,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
