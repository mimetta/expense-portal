import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/lib/notifications";
import { ceoWebhookUrl, postToWebhook } from "@/lib/discord";
import type { BudgetRevision } from "@/lib/budget-revisions";

// Budget-revision notifications, built on the SAME two mechanisms expense
// requests already use — lib/notifications.ts for the bell, lib/discord.ts for
// the channel — rather than a second parallel system.
//
// It goes through notifyUsers() rather than notifyInApp(), which is the seam
// already provided for exactly this case: notifyInApp recomputes recipients
// from an ExpenseRequest's status via isBoActionable/isCeoActionable/…, and a
// budget revision is not a request and has none of those. notifyUsers is
// already exported "for the two Edit Request routes (which already know
// exactly who to notify)"; this is the third such caller.
//
// notifications.request_id is TEXT with no FK to requests (deliberately, per
// migration 027's header), so it carries the revision id here. The bell routes
// on the event prefix — see components/NotificationBell.tsx.
export const BUDGET_EVENT_PREFIX = "BUDGET_";

const short = (email: string) => email.replace("@mimetta.co", "");

/** Every CEO, plus every SUPERADMIN — the people who can act on a submission. */
async function approverEmails(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .select("email, role")
    .in("role", ["CEO", "SUPERADMIN"]);
  if (error) {
    console.error("[budget-notify] failed to load approvers:", error);
    return [];
  }
  return Array.from(new Set((data ?? []).map((r) => r.email as string)));
}

async function toCeoChannel(message: string): Promise<void> {
  const url = ceoWebhookUrl();
  if (!url) {
    // Same posture as lib/discord.ts#notify: log loudly, never throw — a
    // missing webhook must not fail the transition that triggered it.
    console.error("[budget-notify] DISCORD_WEBHOOK_CEO is not set; message not sent:", message);
    return;
  }
  await postToWebhook(url, message);
}

/** DRAFT -> SUBMITTED. Tells the people who can approve it that it exists. */
export async function notifyBudgetSubmitted(
  revision: BudgetRevision,
  submittedBy: string,
  lineCount: number,
  fyTotal: number,
): Promise<void> {
  const onBehalf = submittedBy !== revision.owner_email;
  const who = onBehalf
    ? `${short(submittedBy)} (on behalf of ${short(revision.owner_email)})`
    : short(revision.owner_email);
  const total = `฿${Math.round(fyTotal).toLocaleString("en-US")}`;

  const recipients = (await approverEmails()).filter((e) => e !== submittedBy);
  await notifyUsers(
    recipients,
    revision.id,
    "BUDGET_SUBMITTED",
    `Budget FY${revision.fiscal_year} rev ${revision.revision_no} from ${who} is waiting for your approval (${lineCount} lines, ${total})`,
  );
  await toCeoChannel(
    `📊 **Budget submitted for approval** — FY${revision.fiscal_year} revision ${revision.revision_no}\n` +
      `Owner: ${revision.owner_email}${onBehalf ? `\nSubmitted by: ${submittedBy}` : ""}\n` +
      `${lineCount} lines · ${total}\nReview: /budget/review/${revision.id}`,
  );
}

/**
 * SUBMITTED -> APPROVED. Goes to the owner and to whoever submitted it (often
 * the same person; notifyUsers dedupes), minus the approver themselves — who
 * on a self-approval is all three.
 */
export async function notifyBudgetApproved(
  revision: BudgetRevision,
  approvedBy: string,
  selfApproved: boolean,
): Promise<void> {
  const recipients = [revision.owner_email, revision.submitted_by ?? ""].filter(
    (e) => e && e !== approvedBy,
  );
  await notifyUsers(
    recipients,
    revision.id,
    "BUDGET_APPROVED",
    `Budget FY${revision.fiscal_year} rev ${revision.revision_no} was approved by ${short(approvedBy)} — it is now live in the spend report`,
  );
  await toCeoChannel(
    `✅ **Budget approved** — FY${revision.fiscal_year} revision ${revision.revision_no} (${revision.owner_email})\n` +
      `Approved by: ${approvedBy}` +
      // Said out loud in the channel too: a self-approval had no second pair
      // of eyes, and that should not be discoverable only by reading history.
      (selfApproved ? `\n⚠️ Self-approved — submitted and approved by the same person, no second review` : ""),
  );
}

/** SUBMITTED -> DRAFT with a note. */
export async function notifyBudgetRejected(
  revision: BudgetRevision,
  rejectedBy: string,
  note: string,
): Promise<void> {
  const recipients = [revision.owner_email, revision.submitted_by ?? ""].filter(
    (e) => e && e !== rejectedBy,
  );
  await notifyUsers(
    recipients,
    revision.id,
    "BUDGET_CHANGES_REQUESTED",
    `${short(rejectedBy)} requested changes to budget FY${revision.fiscal_year} rev ${revision.revision_no}: ${note}`,
  );
  await toCeoChannel(
    `↩️ **Budget changes requested** — FY${revision.fiscal_year} revision ${revision.revision_no} (${revision.owner_email})\n` +
      `By: ${rejectedBy}\nNote: ${note}`,
  );
}
