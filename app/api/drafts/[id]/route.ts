import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from("drafts")
      .select("owner_email")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;
    if (existing.owner_email !== user.email) throw new ForbiddenError();

    const { error } = await admin.from("drafts").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
