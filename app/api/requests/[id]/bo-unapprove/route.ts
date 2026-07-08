import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";

// Did not exist before — BO approvals had no reversal at all. Restricted
// from the start to the BO who actually approved it (or SUPERADMIN), since
// letting any BO unwind another BO's decision would undermine the approval
// record. No Discord notification, matching the existing convention for
// reversals elsewhere (Accounting's "Mark Unpaid" also doesn't notify).
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (existing.status !== "BO_APPROVED") {
      throw new ConflictError(`Request ${id} is not BO_APPROVED (status: ${existing.status})`);
    }
    if (!isSuperadmin(user) && existing.bo_approver !== user.email) {
      throw new ForbiddenError("You can only unapprove requests you approved");
    }

    const targetStatus = existing.requires_po ? "PO_UPLOADED" : "SUBMITTED";

    const updated = await updateRequest(admin, id, {
      status: targetStatus,
      bo_approver: null,
      bo_approved_at: null,
    });

    await logAudit(user.email, id, "BO_UNAPPROVED", { reverted_to: targetStatus });

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
