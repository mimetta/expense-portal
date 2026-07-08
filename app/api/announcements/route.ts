import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";

// Homepage announcements. Any signed-in user reads only active ones,
// pinned first then newest; SUPERADMIN manages the full list via Settings
// > Announcements (which passes ?all=1 to also see inactive rows).
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const wantsAll = searchParams.get("all") === "1";

    if (wantsAll && !isSuperadmin(user)) throw new ForbiddenError();

    const admin = createAdminClient();
    let query = admin
      .from("announcements")
      .select("*")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (!wantsAll) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ announcements: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateAnnouncementBody {
  title?: string;
  message?: string;
  is_pinned?: boolean;
  attachment_url?: string;
  attachment_type?: string;
}

// Shown on every homepage load, unlike request attachments (only loaded
// when someone opens that specific request's detail modal) — a smaller cap
// than the 5MB used for request attachments to keep the homepage light.
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function attachmentTooLarge(dataUrl: string | undefined): boolean {
  if (!dataUrl) return false;
  // Rough base64 → byte size estimate (4 chars ≈ 3 bytes), good enough for
  // a size guard without decoding the whole string.
  return dataUrl.length * 0.75 > MAX_ATTACHMENT_BYTES;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const body = (await request.json()) as CreateAnnouncementBody;
    if (!body.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (attachmentTooLarge(body.attachment_url)) {
      return NextResponse.json({ error: "Attachment is larger than 2MB" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("announcements")
      .insert({
        title: body.title,
        message: body.message || null,
        is_pinned: body.is_pinned ?? false,
        created_by: user.email,
        attachment_url: body.attachment_url || null,
        attachment_type: body.attachment_type || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ announcement: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
