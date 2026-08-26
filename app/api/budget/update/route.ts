import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

// Ported from onest-cashflow's /api/pl/update. That route had two branches —
// "budget" (goal) and "actual" — because actual was a manually-entered table.
// Actual is now the cashflow_actuals VIEW (auto-summed from paid ONEST
// requests, see migration 014), so it can no longer be edited here. Only
// the budget/goal branch survives; a request for field: "actual" is
// rejected with a clear message instead of silently doing nothing.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO", "ACCOUNTING"])) throw new ForbiddenError();

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const { line_item_id, year, month, field, value } = body as {
      line_item_id: string;
      year: number;
      month: number;
      field: string;
      value: number;
    };
    if (!line_item_id || !year || !month || !field || value == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (field === "actual") {
      return NextResponse.json(
        { error: "Actual is now derived automatically from paid Onest requests and can't be edited here." },
        { status: 400 }
      );
    }
    if (field !== "budget") {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const monthDate = `${year}-${String(month).padStart(2, "0")}-01`;

    const payload = {
      line_item_id,
      submitted_by: user.email,
      month: monthDate,
      amount: value,
      status: "approved" as const,
      version: 1,
      visible_to_ceo: true,
      note: `Inline edit by ${user.email} — ${now}`,
      submitted_at: now,
    };
    const { error } = await admin
      .from("cashflow_budget_submissions")
      .upsert(payload, { onConflict: "line_item_id,month" });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
