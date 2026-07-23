import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// One saved signature per user (supabase/migrations/017_saved_signatures.sql),
// reused across PDF-signing sessions (components/shared/PDFSigner.tsx) so a
// BO/CEO/etc. doesn't have to redraw on the trackpad every single time.
// `url` points into the existing "signatures" Storage bucket — the actual
// upload goes through the existing POST /api/storage/upload (bucket=
// "signatures", already allowlisted for BO/CEO/SUPERADMIN/ACCOUNTING/
// PETTY_CASH_CUSTODIAN/EMPLOYEE); this route only persists which URL belongs
// to which signed-in user.
const TABLE_NOT_FOUND = "PGRST205";

export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("saved_signatures")
      .select("url")
      .eq("email", user.email)
      .maybeSingle();

    if (error) {
      if (error.code === TABLE_NOT_FOUND) return NextResponse.json({ url: null });
      throw error;
    }
    return NextResponse.json({ url: data?.url ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}

interface SaveSignatureBody {
  url?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as SaveSignatureBody;
    if (!body.url?.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("saved_signatures")
      .upsert({ email: user.email, url: body.url, updated_at: new Date().toISOString() }, { onConflict: "email" });

    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json(
          { error: "Saved signatures aren't available yet — ask an admin to apply migration 017." },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();
    const { error } = await admin.from("saved_signatures").delete().eq("email", user.email);
    if (error) {
      if (error.code === TABLE_NOT_FOUND) return NextResponse.json({ ok: true });
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
