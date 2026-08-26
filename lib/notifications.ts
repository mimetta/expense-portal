import { createAdminClient } from "@/lib/supabase/admin";
import { boScopeMatchesRequest } from "@/lib/permissions";
import {
  isAccountingActionable,
  isBoActionable,
  isCeoActionable,
  isPettyCashApprovable,
  needsProcurement,
} from "@/lib/status";
import { PETTY_CASH_LABEL } from "@/lib/constants";
import type { ExpenseRequest, RoleRow } from "@/types/database";

type NewNotification = {
  user_email: string;
  request_id: string;
  event: string;
  message: string;
};

// Low-level insert, exported for the two Edit Request routes (which already
// know exactly who to notify via lib/status.ts#editRequestApproverStage and
// don't need the "who can act on the current state" recomputation below).
export async function notifyUsers(
  recipients: string[],
  requestId: string,
  event: string,
  message: string,
) {
  const emails = Array.from(new Set(recipients)).filter(Boolean);
  if (emails.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert(
    emails.map((user_email) => ({ user_email, request_id: requestId, event, message })),
  );
  if (error) console.error("[notifications] insert failed:", error);
}

// Requester-facing message per event — deliberately a subset of
// NotificationEvent (mirrors lib/discord.ts's formatMessage): SUBMITTED has
// no requester message since they're the one who just did it.
const REQUESTER_MESSAGE: Partial<Record<string, (r: ExpenseRequest) => string>> = {
  PO_UPLOADED: (r) => `PO uploaded for ${r.request_id}`,
  BO_APPROVED: (r) => `${r.request_id} was approved by BO`,
  CEO_APPROVED: (r) => `${r.request_id} was approved by CEO${r.ceo_signature_required ? " (signature required)" : ""}`,
  PAID: (r) => `${r.request_id} has been marked as paid`,
  REJECTED: (r) => `${r.request_id} was rejected${r.reject_reason ? `: ${r.reject_reason}` : ""}`,
  RESUBMITTED: (r) => `${r.request_id} was resubmitted`,
  EDIT_RESUBMITTED: (r) => `Your edit to ${r.request_id} was resubmitted`,
  PETTY_CASH_APPROVED: (r) => `Petty cash custodian signed off on ${r.request_id}`,
};

function actionableMessage(r: ExpenseRequest): string {
  return `${r.request_id} (${r.requester_name}) is waiting for your approval`;
}

// Call this right alongside every existing lib/discord.ts#notify() call
// (same event + updated request) — it does two things:
//  1. Pings the requester with a plain-language status update (unless the
//     event has no REQUESTER_MESSAGE entry, e.g. SUBMITTED).
//  2. Pings whoever can now act on the request, reusing the exact same
//     isBoActionable/isCeoActionable/etc. helpers the approval pages
//     themselves filter on — so "who gets pinged" can never drift out of
//     sync with "who actually sees it in their queue".
// Safe to call for any event/status combination; it only ever inserts rows
// for conditions that are actually true of the passed-in request.
export async function notifyInApp(event: string, request: ExpenseRequest) {
  const rows: NewNotification[] = [];

  const requesterMsg = REQUESTER_MESSAGE[event]?.(request);
  if (requesterMsg && request.requester_email) {
    rows.push({
      user_email: request.requester_email,
      request_id: request.request_id,
      event,
      message: requesterMsg,
    });
  }

  const admin = createAdminClient();
  const { data: roleRows, error } = await admin.from("roles").select("*");
  if (error) {
    console.error("[notifications] failed to load roles:", error);
  } else {
    const roles = (roleRows ?? []) as RoleRow[];
    const recipients = new Set<string>();

    if (needsProcurement(request)) {
      roles.filter((r) => r.role === "PROCUREMENT").forEach((r) => recipients.add(r.email));
    }
    if (
      request.expense_type === PETTY_CASH_LABEL &&
      isPettyCashApprovable(request) &&
      request.petty_cash_holder_email
    ) {
      recipients.add(request.petty_cash_holder_email);
    }
    if (isBoActionable(request)) {
      roles
        .filter((r) => r.role === "BO" && boScopeMatchesRequest(r, request))
        .forEach((r) => recipients.add(r.email));
    }
    if (isCeoActionable(request)) {
      roles.filter((r) => r.role === "CEO").forEach((r) => recipients.add(r.email));
    }
    if (isAccountingActionable(request)) {
      roles.filter((r) => r.role === "ACCOUNTING").forEach((r) => recipients.add(r.email));
    }

    // Don't ping someone about their own request just because they also
    // hold the approving role for it.
    recipients.delete(request.requester_email);

    const message = actionableMessage(request);
    recipients.forEach((user_email) => {
      rows.push({ user_email, request_id: request.request_id, event: "PENDING_APPROVAL", message });
    });
  }

  if (rows.length === 0) return;
  const { error: insertError } = await admin.from("notifications").insert(rows);
  if (insertError) console.error("[notifications] insert failed:", insertError);
}
