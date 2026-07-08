import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";

// Did not exist before — see bo-unapprove/route.ts for the same reasoning
// (restricted to the CEO who actually approved it, or SUPERADMIN; no
// Discord notification on reversal).
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (existing.status !== "CEO_APPROVED") {
      throw new ConflictError(`Request ${id} is not CEO_APPROVED (status: ${existing.status})`);
    }
    if (!isSuperadmin(user) && existing.ceo_approver !== user.email) {
      throw new ForbiddenError("You can only unapprove requests you approved");
    }

    const targetStatus = existing.skip_bo
      ? existing.requires_po
        ? "PO_UPLOADED"
        : "SUBMITTED"
      : "BO_APPROVED";

    const updated = await updateRequest(admin, id, {
      status: targetStatus,
      ceo_approver: null,
      ceo_approved_at: null,
    });

    await logAudit(user.email, id, "CEO_UNAPPROVED", { reverted_to: targetStatus });

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
