import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { listForReview, saveBranches, type BranchAssignment } from "@/lib/branch-review";

// GET  /api/branch-review?department=&year=&reviewed=unreviewed|all
// PUT  /api/branch-review   { assignments: [{ request_id, branch }] }
//
// Access is decided in lib/branch-review.ts#reviewableDepartments and
// enforced per ROW on write, not once per request: a bulk "set selected to…"
// is exactly where a row from a department the caller does not own would
// otherwise slip through.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    const yearRaw = Number(q.get("year"));
    return NextResponse.json(await listForReview(user, {
      department: q.get("department"),
      fiscalYear: Number.isInteger(yearRaw) ? yearRaw : null,
      reviewed: q.get("reviewed") === "all" ? "all" : "unreviewed",
    }));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { assignments?: BranchAssignment[] };
    const assignments = (body.assignments ?? []).filter((a) => a?.request_id && a?.branch);
    return NextResponse.json(await saveBranches(user, assignments));
  } catch (err) {
    return handleApiError(err);
  }
}
