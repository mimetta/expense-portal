import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage, canViewBudgetDept, hasAnyRole } from "@/lib/permissions";
import { getPLData } from "@/lib/budget/data";

// GET /api/budget/data?year=2026&month=7
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!canAccessPage(user, "budget")) throw new ForbiddenError();

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = Number(searchParams.get("year") ?? now.getFullYear());
    const month = Number(searchParams.get("month") ?? now.getMonth() + 1);

    const data = await getPLData(year, month);

    // DEPT_HEAD (and no broader role) only sees their own department's
    // groups within each section — everyone else sees everything.
    const isFullAccess = hasAnyRole(user, ["SUPERADMIN", "CEO", "ACCOUNTING"]);
    if (!isFullAccess) {
      data.sections = data.sections
        .map((s) => ({
          ...s,
          groups: s.groups.filter((g) => canViewBudgetDept(user, { full_name: g.deptFullName })),
        }))
        .filter((s) => s.groups.length > 0);
    }

    const effectiveRole = hasAnyRole(user, ["SUPERADMIN"]) ? "SUPERADMIN"
      : hasAnyRole(user, ["CEO"]) ? "CEO"
      : hasAnyRole(user, ["ACCOUNTING"]) ? "ACCOUNTING"
      : hasAnyRole(user, ["DEPT_HEAD"]) ? "DEPT_HEAD"
      : null;

    return NextResponse.json({ data, role: effectiveRole, isFullAccess });
  } catch (err) {
    return handleApiError(err);
  }
}
