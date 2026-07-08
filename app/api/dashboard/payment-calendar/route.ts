import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canViewRequest } from "@/lib/permissions";
import type { ExpenseRequest } from "@/types/database";

// Homepage Payment Calendar: requests with due_date in the current calendar
// month that aren't PAID yet. REJECTED is also excluded — a rejected
// request will never be paid unless resubmitted, at which point it's live
// again with a (possibly new) due_date; a dead request cluttering a
// "what's coming due" view isn't useful. Scoped to whatever the current
// user is allowed to see (canViewRequest), same as GET /api/requests/[id].
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

    const { data, error } = await admin
      .from("requests")
      .select("*")
      .gte("due_date", monthStart)
      .lt("due_date", monthEnd)
      .order("due_date", { ascending: true });
    if (error) throw error;

    const requests = ((data ?? []) as ExpenseRequest[])
      .filter((r) => r.status !== "PAID" && r.status !== "REJECTED")
      .filter((r) => canViewRequest(user, r));

    return NextResponse.json({ requests });
  } catch (err) {
    return handleApiError(err);
  }
}
