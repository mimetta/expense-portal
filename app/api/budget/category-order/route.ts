import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { getCategoryOrder, saveCategoryOrder } from "@/lib/budget-order";

// The owner's own category display order. Never a revision, never a figure —
// see migration 041.

// GET /api/budget/category-order?ownerEmail=
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const owner = new URL(req.url).searchParams.get("ownerEmail") || user.email;
    // Reading someone else's arrangement is only meaningful while acting on
    // their behalf, which is a SUPERADMIN-only mode already.
    if (owner !== user.email && !isSuperadmin(user)) {
      return NextResponse.json({ error: "Only an admin can read another owner's order." }, { status: 403 });
    }
    return NextResponse.json({ order: await getCategoryOrder(owner) });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT /api/budget/category-order  { ownerEmail?, department, catL1s: [...] }
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { ownerEmail?: string; department?: string; catL1s?: string[] };
    const owner = body.ownerEmail ?? user.email;
    if (!body.department || !Array.isArray(body.catL1s)) {
      return NextResponse.json({ error: "department and catL1s are required" }, { status: 400 });
    }
    // saveCategoryOrder re-checks this; doing it here too keeps the 403 ahead
    // of any write, matching every other route in this app.
    if (owner !== user.email && !isSuperadmin(user)) {
      return NextResponse.json({ error: "You can only reorder your own budget." }, { status: 403 });
    }
    const res = await saveCategoryOrder(owner, body.department, body.catL1s, user);
    return NextResponse.json({ ...res, savedAt: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
}
