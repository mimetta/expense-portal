import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { editRequestApproverStage, isEditRequestPending } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { departmentWebhookUrl, postToWebhook } from "@/lib/discord";

const UNDEFINED_COLUMN = "42703";

function isPostgrestLikeError(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

// Step 2 of the Edit Request workflow (see request-edit/route.ts for step
// 1): the approver at whichever stage the request is currently sitting at
// (BO/CEO/Accounting — see lib/status.ts#editRequestApproverStage) allows
// or rejects the pending request. Allow moves status to EDIT_REQUESTED
// (unlocking full-form owner editing — see the edit_resubmit branch of
// PATCH /api/requests/[id]) and stamps status_before_edit so the eventual
// resubmit knows where to land back. Reject just clears the pending
// request's markers; status never changes.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await request.json()) as { allow?: boolean };

    if (typeof body.allow !== "boolean") {
      return NextResponse.json({ error: "allow (boolean) is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (!isEditRequestPending(existing)) {
      throw new ConflictError(`Request ${id} has no pending edit request`);
    }

    const stage = editRequestApproverStage(existing);
    const authorized =
      isSuperadmin(user) ||
      (stage === "BO" && hasRole(user, "BO") && canBoActOnRequest(user, existing)) ||
      (stage === "CEO" && hasRole(user, "CEO")) ||
      (stage === "ACCOUNTING" && hasRole(user, "ACCOUNTING"));
    if (!authorized) throw new ForbiddenError();

    let updated;
    try {
      if (body.allow) {
        updated = await updateRequest(admin, id, {
          status: "EDIT_REQUESTED",
          status_before_edit: existing.status,
          edit_approved_by: user.email,
          edit_approved_at: new Date().toISOString(),
        });
      } else {
        updated = await updateRequest(admin, id, {
          edit_requested_at: null,
          edit_requested_reason: null,
        });
      }
    } catch (err) {
      if (isPostgrestLikeError(err) && err.code === UNDEFINED_COLUMN) {
        return NextResponse.json(
          { error: "Edit request workflow isn't available yet — ask an admin to apply migration 009." },
          { status: 503 },
        );
      }
      throw err;
    }

    await logAudit(user.email, id, body.allow ? "EDIT_ALLOWED" : "EDIT_REJECTED", {});

    if (!body.allow) {
      const message = `🚫 Edit request rejected for **${existing.request_id}**\nRequested by: ${existing.requester_name} (${existing.requester_email})\nby ${user.email}`;
      const deptUrl = departmentWebhookUrl(existing.department);
      if (deptUrl) await postToWebhook(deptUrl, message);
    }

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
