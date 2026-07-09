import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { canRequestEdit } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { departmentWebhookUrl, postToWebhook } from "@/lib/discord";

// Postgrest's "column does not exist" code — thrown if
// supabase/migrations/009_edit_request.sql isn't applied yet. See
// CLAUDE.md "Edit Request approval workflow".
const UNDEFINED_COLUMN = "42703";

const ACCOUNTING_NOTIFY_EMAILS = ["ladda.t@mimetta.co", "chutikarn.p@mimetta.co"];

// Step 1 of the Edit Request workflow: the owner asks permission to edit a
// request that's already past their own free-edit window (isOwnerEditable —
// that's a different, earlier flow). Status is NOT changed here — only
// edit_requested_at/reason are set, so the request stays visible/actionable
// wherever it already was until an approver actually grants it (see
// approve-edit/route.ts). "Notify the relevant approver" has no literal
// per-user Discord DM available in this app (same constraint as the
// document-reminder cron) — the approver's name/email is named in the
// department-channel message text instead.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await request.json()) as { reason?: string };

    if (!body.reason?.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (existing.requester_email !== user.email && !isSuperadmin(user)) {
      throw new ForbiddenError();
    }
    if (!canRequestEdit(existing)) {
      throw new ConflictError(
        `Request ${id} can't have an edit requested right now (status: ${existing.status}${existing.edit_requested_at ? ", already pending" : ""})`,
      );
    }

    let updated;
    try {
      updated = await updateRequest(admin, id, {
        edit_requested_at: new Date().toISOString(),
        edit_requested_reason: body.reason,
      });
    } catch (err) {
      if (isPostgrestLikeError(err) && err.code === UNDEFINED_COLUMN) {
        return NextResponse.json(
          { error: "Edit request workflow isn't available yet — ask an admin to apply migration 009." },
          { status: 503 },
        );
      }
      throw err;
    }

    await logAudit(user.email, id, "EDIT_REQUESTED", { reason: body.reason, at_status: existing.status });

    const approverLabel =
      existing.status === "BO_APPROVED"
        ? `BO (${existing.bo_approver ?? "-"})`
        : existing.status === "CEO_APPROVED"
          ? `CEO (${existing.ceo_approver ?? "-"})`
          : `Accounting (${ACCOUNTING_NOTIFY_EMAILS.join(", ")})`;
    const message = `✏️ Edit requested for **${existing.request_id}** by ${existing.requester_name}\nApprover: ${approverLabel}\nReason: ${body.reason}`;
    const deptUrl = departmentWebhookUrl(existing.department);
    if (deptUrl) await postToWebhook(deptUrl, message);

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

function isPostgrestLikeError(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
