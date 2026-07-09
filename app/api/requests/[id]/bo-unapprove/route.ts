import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";

// Originally restricted to "only the BO who approved it" — a later spec
// explicitly asked to remove that ("Any BO can unapprove any BO_APPROVED
// request (within their scope)"), while keeping the scope check, so any BO
// whose bu_scope/dept_scope/cat_l1_scope actually covers this request can
// unapprove it, not just the one who happened to click Approve. The spec
// referenced "/api/approve/route.ts" as the file to update — that file has
// never existed in this codebase (bo-unapprove/ceo-unapprove are, and
// always have been, separate routes; see CLAUDE.md "BO/CEO unapprove"),
// same kind of false premise as the earlier "fix unapprove logic" request
// that led to these routes being built in the first place. Still no
// Discord notification on reversal, matching the existing convention.
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
    if (!isSuperadmin(user) && !(hasRole(user, "BO") && canBoActOnRequest(user, existing))) {
      throw new ForbiddenError("This request is outside your BO scope");
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
