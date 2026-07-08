import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { isAccountingActionable, isCeoActionable, isBoActionable, isTerminal, needsProcurement } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import type { RejectionHistoryEntry } from "@/types/database";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await request.json()) as { reason?: string };
    if (!body.reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (isTerminal(existing)) {
      throw new ConflictError(`Request ${id} is already ${existing.status}`);
    }

    const canReject =
      isSuperadmin(user) ||
      (hasRole(user, "PROCUREMENT") && needsProcurement(existing)) ||
      (hasRole(user, "BO") && isBoActionable(existing) && canBoActOnRequest(user, existing)) ||
      (hasRole(user, "CEO") && isCeoActionable(existing)) ||
      (hasRole(user, "ACCOUNTING") && isAccountingActionable(existing));

    if (!canReject) throw new ForbiddenError();

    const entry: RejectionHistoryEntry = {
      stage: existing.status,
      actor_email: user.email,
      reason: body.reason,
      rejected_at: new Date().toISOString(),
    };

    const updated = await updateRequest(admin, id, {
      status: "REJECTED",
      rejected_by: user.email,
      rejected_stage: existing.status,
      reject_reason: body.reason,
      rejected_at: entry.rejected_at,
      rejection_history: [...existing.rejection_history, entry],
    });

    await logAudit(user.email, id, "REJECTED", { stage: existing.status, reason: body.reason });
    await notify("REJECTED", updated);

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
