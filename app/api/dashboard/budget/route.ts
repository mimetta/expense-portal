import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage } from "@/lib/permissions";
import type { ExpenseRequest } from "@/types/database";

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

// "Actual" is defined as PAID requests only — money that has actually left
// the company — as opposed to submitted-but-not-yet-paid commitments.
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!canAccessPage(user, "dashboard")) throw new ForbiddenError();

    const { searchParams } = new URL(request.url);
    const bu = searchParams.get("bu");

    const admin = createAdminClient();

    let budgetQuery = admin.from("budget_2026").select("*");
    if (bu) budgetQuery = budgetQuery.eq("bu", bu);
    const { data: budgetRows, error: budgetError } = await budgetQuery;
    if (budgetError) throw budgetError;

    let requestsQuery = admin.from("requests").select("*").eq("status", "PAID");
    if (bu) requestsQuery = requestsQuery.eq("bu", bu);
    const { data: paidRequests, error: requestsError } = await requestsQuery;
    if (requestsError) throw requestsError;

    const actualByKey = new Map<string, number[]>(); // 12 months per key
    for (const r of (paidRequests ?? []) as ExpenseRequest[]) {
      const [year, month] = r.budget_period.split("-");
      if (year !== "2026") continue;
      const monthIdx = Number(month) - 1;
      if (monthIdx < 0 || monthIdx > 11) continue;

      const key = `${r.bu}|${r.department}|${r.cat_l1 ?? ""}`;
      const arr = actualByKey.get(key) ?? new Array(12).fill(0);
      arr[monthIdx] += r.total;
      actualByKey.set(key, arr);
    }

    const rows = (budgetRows ?? []).map((row) => {
      const key = `${row.bu}|${row.department}|${row.cat_l1 ?? ""}`;
      const actual = actualByKey.get(key) ?? new Array(12).fill(0);
      const budget = MONTH_KEYS.map((m) => Number(row[m] ?? 0));
      return {
        bu: row.bu,
        department: row.department,
        responsibility: row.responsibility,
        cat_l1: row.cat_l1,
        cat_l2: row.cat_l2,
        budget,
        actual,
      };
    });

    return NextResponse.json({ rows, months: MONTH_KEYS });
  } catch (err) {
    return handleApiError(err);
  }
}
