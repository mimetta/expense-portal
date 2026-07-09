import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";

// See bo-unapprove/route.ts — same later-spec change (any CEO can unapprove
// any CEO_APPROVED request, not just the one who approved it; CEO has no
// scope concept the way BO does, so this is just a role check now) and the
// same "/api/approve/route.ts" false-premise note.
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
    if (!isSuperadmin(user) && !hasRole(user, "CEO")) {
      throw new ForbiddenError();
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
