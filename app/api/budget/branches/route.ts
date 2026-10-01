import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { listBranches } from "@/lib/branches";

// GET /api/budget/branches — the branch list for the budget page's selector.
//
// A branch IS a revenue channel, so this reads revenue_channels rather than a
// branches table; see lib/branches.ts. Any signed-in user may read it: the
// list is store names, carries no figures, and the budget page already gates
// what can be edited.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const raw = new URL(req.url).searchParams.get("year");
    const year = Number(raw);
    const fiscalYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined;
    return NextResponse.json({ branches: await listBranches(fiscalYear) });
  } catch (err) {
    return handleApiError(err);
  }
}
