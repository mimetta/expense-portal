import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { synthRows } from "@/lib/roles-compat";

// STAGE 2b: backed by `people` / `person_roles` / `bo_scopes`, NOT the legacy
// `roles` table. The request and response shapes are unchanged so Settings >
// User Management and /submit's Slip Receiver picker keep working; each
// synthetic row's `id` is `email|ROLE`, which is the real primary key of
// person_roles.
//
// The legacy table is deliberately left in place, unread and unwritten, as
// the rollback path.

export async function GET(request: Request) {
  try {
    await requireUser();
    const admin = createAdminClient();

    const { searchParams } = new URL(request.url);
    if (searchParams.get("distinct") === "chapter") {
      const { data, error } = await admin.from("people").select("chapter");
      if (error) return NextResponse.json({ chapters: [] });
      const chapters = Array.from(
        new Set((data ?? []).map((r) => String(r.chapter ?? "").trim()).filter(Boolean)),
      ).sort();
      return NextResponse.json({ chapters });
    }

    return NextResponse.json({ roles: await synthRows(admin) });
  } catch (err) {
    return handleApiError(err);
  }
}

// STAGE 2c: POST retired. Role management lives on Settings > Users & access
// (PUT /api/users-access), which validates the lockout and BO-overlap rules
// and writes an audit row. This endpoint wrote `people`/`person_roles`/
// `bo_scopes` with NO audit trail — that is how panwipa.s's promotion to
// ACCOUNTING left no record of who made it or when.
//
// GET above is kept: /submit's Slip Payment Receiver picker and
// RequestDetailModal both read the email list from it.
export async function POST() {
  return NextResponse.json(
    {
      error:
        "User management has moved to Settings > Users & access. This endpoint no longer " +
        "writes, because it could not record who changed what.",
    },
    { status: 410 },
  );
}
