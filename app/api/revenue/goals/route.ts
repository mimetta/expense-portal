import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import {
  getRevenueTree,
  saveRevenueGoals,
  canEditRevenueGoals,
  type GoalEntry,
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
    const { tree, channels } = await getRevenueTree(year, bu);
    return NextResponse.json({
      tree,
      channels,
      fiscalYear: year,
      canEdit: canEditRevenueGoals(user),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT /api/revenue/goals  { fiscalYear, entries: [{channelId, month, amount}] }
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { fiscalYear: number; entries: GoalEntry[] };
    if (!Number.isInteger(Number(body.fiscalYear)) || !Array.isArray(body.entries)) {
      return NextResponse.json({ error: "fiscalYear and entries are required" }, { status: 400 });
    }
    const result = await saveRevenueGoals(Number(body.fiscalYear), body.entries, user);
    return NextResponse.json({ ...result, savedAt: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
}
