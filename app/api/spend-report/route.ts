import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage } from "@/lib/permissions";
import { ALL_MONTHS, getSpendReport, type SpendBasis } from "@/lib/spend";
import { BUSINESS_UNITS } from "@/lib/constants";

// Postgrest codes for "the thing this route needs does not exist yet".
// Migration 016 has not been applied to the live database as of this writing
// (this agent environment has no SUPABASE_ACCESS_TOKEN — see CLAUDE.md
// "Database Schema"), so until it is, this returns a friendly 503 rather than
// a 500, the same graceful-degradation pattern the announcements/calendar/
// edit-request routes already use.
const MISSING_RELATION = new Set(["PGRST205", "42P01"]);

function isMissingRelation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    MISSING_RELATION.has(String((err as { code?: unknown }).code))
  );
}

// GET /api/spend-report?year=2026&bu=SV&months=7,8,9&basis=approved&department=Retail
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // The actual security boundary — the hidden nav item is only UX.
    if (!canAccessPage(user, "spend-report")) throw new ForbiddenError();

    const { searchParams } = new URL(req.url);

    const fiscalYear = Number(searchParams.get("year") ?? new Date().getFullYear());
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }

    const buParam = searchParams.get("bu");
    const bu =
      buParam && (BUSINESS_UNITS as readonly string[]).includes(buParam) ? buParam : null;

    const monthsParam = searchParams.get("months");
    const months = monthsParam
      ? Array.from(
          new Set(
            monthsParam
              .split(",")
              .map((m) => Number(m.trim()))
              .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
          ),
        ).sort((a, b) => a - b)
      : ALL_MONTHS;
    if (months.length === 0) {
      return NextResponse.json({ error: "Invalid months" }, { status: 400 });
    }

    const basis: SpendBasis = searchParams.get("basis") === "paid" ? "paid" : "approved";
    const departmentFilter = searchParams.get("department") || null;

    const report = await getSpendReport({
      bu,
      fiscalYear,
      months,
      basis,
      departmentFilter,
      viewer: user,
    });

    return NextResponse.json(report);
  } catch (err) {
    if (isMissingRelation(err)) {
      return NextResponse.json(
        {
          error:
            "Spend report tables are not available yet — apply supabase/migrations/016_budgets.sql.",
        },
        { status: 503 },
      );
    }
    return handleApiError(err);
  }
}
