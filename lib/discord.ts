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
  if (!envName) {
    console.warn(
      `[discord] No DEPARTMENT_WEBHOOK_ENV entry for department "${department}" — check exact ` +
        `spelling/case against lib/constants.ts (this is case-sensitive). Falling back to ${DEFAULT_WEBHOOK_ENV}.`,
    );
  }
  const resolved = webhookUrlFor(envName) ?? webhookUrlFor(DEFAULT_WEBHOOK_ENV);
  if (!resolved) {
    console.error(
      `[discord] No webhook URL resolved for department "${department}" — set ${envName ?? DEFAULT_WEBHOOK_ENV} ` +
        `in the environment.`,
    );
  }
  return resolved;
}

// Returns whether the post succeeded, so callers (e.g. /api/test-discord)
// can report success/failure instead of assuming it worked. fetch() only
// rejects on network failure — a bad/deleted webhook URL still resolves
// with a non-2xx response, so that has to be checked explicitly too.
export async function postToWebhook(url: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[discord] Webhook post returned ${res.status} ${res.statusText}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[discord] Webhook post failed:", err);
    return false;
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
  if (deptUrl) {
    await postToWebhook(deptUrl, message);
  } else {
    console.error(
      `[discord] ${event} notification for ${request.request_id} was not sent — no webhook URL available ` +
        `for department "${request.department}" (checked DEPARTMENT_WEBHOOK_ENV and ${DEFAULT_WEBHOOK_ENV}).`,
    );
  }

  const shouldPingCeo =
    event === "CEO_APPROVED" ||
    event === "PAID" ||
    (event === "PO_UPLOADED" && request.skip_bo);

  if (shouldPingCeo) {
    const ceoUrl = webhookUrlFor(CEO_WEBHOOK_ENV);
    if (ceoUrl && ceoUrl !== deptUrl) await postToWebhook(ceoUrl, message);
  }
}
