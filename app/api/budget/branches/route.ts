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

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ branches: await listBranches() });
  } catch (err) {
    return handleApiError(err);
  }
}
