import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

const TABLE_NOT_FOUND = "PGRST205";

// Delete one of the signed-in user's own saved payment presets. Ownership
// is checked server-side (owner_email must match the session) rather than
// trusting the id alone — the same reasoning as every other owner-scoped
// mutation in this app (e.g. request owner delete).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from("payment_presets")
      .select("owner_email")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) {
      if (fetchError.code === TABLE_NOT_FOUND) return NextResponse.json({ ok: true });
      throw fetchError;
    }
    if (!existing) return NextResponse.json({ ok: true });
    if (existing.owner_email !== user.email) throw new ForbiddenError();

    const { error } = await admin.from("payment_presets").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
