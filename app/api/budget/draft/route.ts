import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { createDraft, saveDraft, type BudgetLine } from "@/lib/budget-revisions";
import { getEditorData, findDraft } from "@/lib/budget-editor";

// POST /api/budget/draft   { ownerEmail?, fiscalYear }  -> create (or return) the draft
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { ownerEmail?: string; fiscalYear: number };
    const owner = body.ownerEmail ?? user.email;
    const year = Number(body.fiscalYear);
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
    }

    // one_draft_per_owner makes a second draft a unique violation; returning
    // the existing one is friendlier than surfacing 23505 to the UI.
    const existing = await findDraft(owner, year);
    if (existing) {
      return NextResponse.json({ revision: existing, created: false });
    }
    const { revision, lines } = await createDraft(owner, year, user);
    return NextResponse.json({ revision, lines, created: true });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT /api/budget/draft    { revisionId, lines }  -> autosave / explicit save
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { revisionId: string; lines: BudgetLine[] };
    if (!body.revisionId || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: "revisionId and lines are required" }, { status: 400 });
    }
    const result = await saveDraft(body.revisionId, body.lines, user);
    return NextResponse.json({ ...result, savedAt: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
}

// GET /api/budget/draft?revisionId=...  -> the editor grid
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const revisionId = new URL(req.url).searchParams.get("revisionId");
    if (!revisionId) return NextResponse.json({ error: "revisionId is required" }, { status: 400 });
    return NextResponse.json(await getEditorData(revisionId, user));
  } catch (err) {
    return handleApiError(err);
  }
}
