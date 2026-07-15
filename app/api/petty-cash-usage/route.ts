import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import type { ExpenseRequest } from "@/types/database";

// Current-month usage for the cash usage bar on /submit's Petty cash holder
// panel. Literal spec: sum of `total` for requests where
// petty_cash_holder_email matches, status != REJECTED, and paid_at falls in
// the current calendar month — same "current calendar month" convention
// already used for the homepage's "Paid This Month" stat (see CLAUDE.md
// "Homepage"). Since only PAID requests ever have paid_at set, this in
// practice counts money already paid out this month, not money merely
// pending/committed — a deliberate reading of the literal spec rather than
// an inferred "count pending requests too" behavior.
export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const holderEmail = searchParams.get("holder_email");
    if (!holderEmail) {
      return NextResponse.json({ error: "holder_email is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("requests")
      .select("total, status, paid_at")
      .eq("petty_cash_holder_email", holderEmail);

    if (error) {
      if (error.code === "42703") {
        // petty_cash_holder_email column not applied yet (migration 012).
        return NextResponse.json({ used: 0 });
      }
      throw error;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const used = ((data ?? []) as Pick<ExpenseRequest, "total" | "status" | "paid_at">[])
      .filter((r) => r.status !== "REJECTED" && r.paid_at)
      .filter((r) => {
        const paidAt = new Date(r.paid_at as string);
        return paidAt >= monthStart && paidAt < monthEnd;
      })
      .reduce((sum, r) => sum + r.total, 0);

    return NextResponse.json({ used });
  } catch (err) {
    return handleApiError(err);
  }
}
