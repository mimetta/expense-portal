import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

const BUCKET = "attachments";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

// Mints a fresh signed URL for an object already in the private
// "attachments" bucket — the stored FileEntry.url (from POST /api/upload)
// is only valid for 7 days, so RequestDetailModal / RequestForm call this
// when opening a file whose stored url might have gone stale. Any
// signed-in user can call this; it only ever re-signs whatever `path` the
// caller already has from a request's own files_json — not a directory
// listing or arbitrary bucket access.
export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) throw error ?? new Error("Failed to create signed URL");

    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
