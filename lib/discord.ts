import {
  CEO_WEBHOOK_ENV,
  DEFAULT_WEBHOOK_ENV,
  DEPARTMENT_WEBHOOK_ENV,
} from "@/lib/constants";
import type { ExpenseRequest } from "@/types/database";

export type NotificationEvent =
  | "SUBMITTED"
  | "PO_UPLOADED"
  | "BO_APPROVED"
  | "CEO_APPROVED"
  | "PAID"
  | "REJECTED"
  | "EDIT_REQUESTED";

function webhookUrlFor(envName: string | undefined): string | null {
  if (!envName) return null;
  return process.env[envName] ?? null;
}

// Exported for app/api/cron/document-reminder/route.ts, which posts a
// bespoke message shape (not one of the NotificationEvent cases below).
export function departmentWebhookUrl(department: string): string | null {
  const envName = DEPARTMENT_WEBHOOK_ENV[department];
  return webhookUrlFor(envName) ?? webhookUrlFor(DEFAULT_WEBHOOK_ENV);
}

export async function postToWebhook(url: string, content: string) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    console.error("Discord webhook post failed:", err);
  }
}

function formatMessage(event: NotificationEvent, r: ExpenseRequest): string {
  const amount = r.total.toLocaleString("en-US", { minimumFractionDigits: 2 });
  const base = `**${r.request_id}** (${r.bu} / ${r.department}) — ฿${amount} — ${r.requester_name}`;

  switch (event) {
    case "SUBMITTED":
      return `📝 New request submitted\n${base}\n${r.expense_type}`;
    case "PO_UPLOADED":
      return `📎 PO uploaded\n${base}\nPO #${r.po_number ?? "-"}`;
    case "BO_APPROVED":
      return `✅ BO approved\n${base}\nby ${r.bo_approver ?? "-"}`;
    case "CEO_APPROVED":
      return `✅ CEO approved${r.ceo_signature_required ? " (signature required)" : ""}\n${base}\nby ${r.ceo_approver ?? "-"}`;
    case "PAID":
      return `💰 Marked as paid\n${base}`;
    case "REJECTED":
      return `❌ Rejected at ${r.rejected_stage ?? "-"}\n${base}\nReason: ${r.reject_reason ?? "-"}`;
    case "EDIT_REQUESTED":
      // Not actually used by the Edit Request workflow itself — that flow
      // posts its own bespoke messages (naming the specific approver) via
      // postToWebhook/departmentWebhookUrl directly, same pattern as the
      // document-reminder cron. This case only exists so NotificationEvent
      // stays exhaustively handled; kept as a reasonable fallback in case
      // notify() is ever called with this event some other way.
      return `✏️ Edit requested\n${base}\nReason: ${r.edit_requested_reason ?? "-"}`;
  }
}

// Sends the event to the request's department channel. Skip-BO requests that
// just had their PO uploaded also ping the CEO channel directly, since the
// BO stage (which would normally act next) is bypassed.
export async function notify(event: NotificationEvent, request: ExpenseRequest) {
  const message = formatMessage(event, request);

  const deptUrl = departmentWebhookUrl(request.department);
  if (deptUrl) await postToWebhook(deptUrl, message);

  const shouldPingCeo =
    event === "CEO_APPROVED" ||
    event === "PAID" ||
    (event === "PO_UPLOADED" && request.skip_bo);

  if (shouldPingCeo) {
    const ceoUrl = webhookUrlFor(CEO_WEBHOOK_ENV);
    if (ceoUrl && ceoUrl !== deptUrl) await postToWebhook(ceoUrl, message);
  }
}
