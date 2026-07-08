import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { departmentWebhookUrl, postToWebhook } from "@/lib/discord";
import type { ExpenseRequest } from "@/types/database";

// No cookies()/auth call in this handler (it's cron-invoked, not
// user-invoked), so without this Next.js tries to statically prerender it
// at build time — which fails without real Supabase env vars available.
export const dynamic = "force-dynamic";

// Invoked by Vercel Cron on the 10th and 14th of each month (see
// vercel.json) as a heads-up before the 15th document deadline for Credit
// (รับของก่อนจ่าย) requests — see the orange deadline banner in
// components/shared/RequestForm.tsx's Attachments section for the
// submitter-facing version of this same reminder. Vercel signs cron
// requests with `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
// set.
//
// "Send to the requester" is implemented as naming them in the message
// text sent to the department channel, not a real per-user Discord DM —
// this app has no Discord user-ID mapping for any user anywhere, so a
// literal direct-message isn't something the existing infra can do.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const now = new Date();
  const currentBudgetPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { data, error } = await admin
    .from("requests")
    .select("*")
    .eq("budget_period", currentBudgetPeriod)
    .like("expense_type", "%Credit-รับของก่อนจ่าย%");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const targets = ((data ?? []) as ExpenseRequest[]).filter(
    (r) => r.status !== "PAID" && r.status !== "REJECTED",
  );

  const reminded: string[] = [];
  for (const r of targets) {
    const message = `⚠️ เอกสาร Credit reminder: **${r.request_id}** ของ ${r.requester_name} กรุณาส่งเอกสารให้ฝ่ายบัญชีภายในวันที่ 15`;
    const deptUrl = departmentWebhookUrl(r.department);
    if (deptUrl) {
      await postToWebhook(deptUrl, message);
      reminded.push(r.request_id);
    }
    await logAudit("system@cron", r.request_id, "DOCUMENT_REMINDER_SENT", {
      budget_period: r.budget_period,
    });
  }

  return NextResponse.json({ checked_count: targets.length, reminded_count: reminded.length, reminded });
}
