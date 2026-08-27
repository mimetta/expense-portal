import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { submitForApproval, approveRevision, rejectRevision } from "@/lib/budget-revisions";

// POST /api/budget/[id]/transition  { action: "submit" | "approve" | "reject", note? }
//
// One route for all three transitions. The action is the ONLY thing the client
// chooses — never the resulting status. lib/budget-revisions.ts re-reads the
// row, re-checks permission and re-validates the current status before every
// write, so a client cannot drive a revision into a state it is not in.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string };

    switch (body.action) {
      case "submit":
        return NextResponse.json({ revision: await submitForApproval(id, user) });
      case "approve":
        return NextResponse.json({ revision: await approveRevision(id, user) });
      case "reject":
        return NextResponse.json({ revision: await rejectRevision(id, body.note ?? "", user) });
      default:
        return NextResponse.json(
          { error: 'action must be "submit", "approve" or "reject"' },
          { status: 400 },
        );
    }
  } catch (err) {
    return handleApiError(err);
  }
}
