import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import {
  getRevenueTree,
  saveRevenueGoals,
  saveRevenueActuals,
  canEditRevenueGoals,
  type GoalEntry,
  type ActualEntry,
} from "@/lib/revenue-goals";

// GET /api/revenue/goals?year=2026&bu=ONEST
// Any signed-in user may READ: a BO plans against the goal, so they have to
// see it. Writing is CEO/SUPERADMIN only, enforced in lib/revenue-goals.ts.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
    const bu = url.searchParams.get("bu") || undefined;
    const { tree, channels, syncedAt } = await getRevenueTree(year, bu);
    return NextResponse.json({
      tree,
      channels,
      fiscalYear: year,
      syncedAt,
      canEdit: canEditRevenueGoals(user),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT /api/revenue/goals
//   { fiscalYear, entries:  [{channelId, month, amount}] }  -> goals
//   { fiscalYear, actuals:  [{channelId, month, actual}] }  -> actuals
//
// Two separate keys rather than one list with a mode flag: a goal and an
// actual are different facts on the same row, and mixing them in one array
// would make "which did this null clear?" ambiguous — a null goal DELETES the
// row, a null actual only clears the actual columns.
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      fiscalYear: number; entries?: GoalEntry[]; actuals?: ActualEntry[];
    };
    if (!Number.isInteger(Number(body.fiscalYear))) {
      return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
    }
    if (!Array.isArray(body.entries) && !Array.isArray(body.actuals)) {
      return NextResponse.json({ error: "entries or actuals is required" }, { status: 400 });
    }
    const year = Number(body.fiscalYear);
    const result = Array.isArray(body.actuals)
      ? await saveRevenueActuals(year, body.actuals, user)
      : await saveRevenueGoals(year, body.entries ?? [], user);
    return NextResponse.json({ ...result, savedAt: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
}
