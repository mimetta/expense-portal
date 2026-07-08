import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

interface UpdateAnnouncementBody {
  title?: string;
  message?: string | null;
  is_pinned?: boolean;
  is_active?: boolean;
  attachment_url?: string | null;
  attachment_type?: string | null;
}

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO"])) throw new ForbiddenError();

    const { id } = await params;
    const body = (await request.json()) as UpdateAnnouncementBody;
    if (body.attachment_url && body.attachment_url.length * 0.75 > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Attachment is larger than 2MB" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("announcements")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ announcement: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO"])) throw new ForbiddenError();

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("announcements").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
