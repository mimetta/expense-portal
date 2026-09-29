import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { refreshDraftLines } from "@/lib/budget-revisions";

// POST /api/budget/draft/refresh  { revisionId }
//
// Additive only: adds lines for categories now in scope that have none, never
// removes a line and never touches a figure. Draft only — refreshDraftLines
// enforces both, along with the owner check.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { revisionId } = (await req.json()) as { revisionId?: string };
    if (!revisionId) {
      return NextResponse.json({ error: "revisionId is required" }, { status: 400 });
    }
    return NextResponse.json(await refreshDraftLines(revisionId, user));
  } catch (err) {
    return handleApiError(err);
  }
}
