import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// "Mark all read" button in the bell dropdown.
export async function PATCH() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    const { error } = await admin
      .from("notifications")
      .update({ is_read: true })
      .eq("user_email", user.email)
      .eq("is_read", false);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
