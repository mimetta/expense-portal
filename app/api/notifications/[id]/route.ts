import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Marks one notification as read — clicking it in the bell dropdown. Scoped
// to the current user's own email so nobody can mark (or even discover the
// existence of) someone else's notification by guessing an id.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from("notifications")
      .select("user_email")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    if (existing.user_email !== user.email) throw new ForbiddenError();

    const { error } = await admin.from("notifications").update({ is_read: true }).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
