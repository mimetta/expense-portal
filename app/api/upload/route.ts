import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Uploads one /submit (or edit-form) attachment to the private "attachments"
// Supabase Storage bucket — see CLAUDE.md "File Storage" for the hybrid
// split (regular attachments here; signature-pad PNGs go through the
// existing public "signatures" bucket via POST /api/storage/upload
// instead). Replaces the earlier Google Drive-based upload
// (app/api/upload-to-drive/route.ts, removed).
const BUCKET = "attachments";

// The bucket is private (not public — see CLAUDE.md), so a signed URL is
// the only way to read an object back; 7 days matches what was asked for.
// A request can obviously outlive 7 days, so this URL is not meant to be
// permanent — RequestDetailModal re-signs on demand via
// GET /api/upload/signed-url using FileEntry.path once a stored url is
// old enough to have expired, rather than assuming `url` is forever valid.
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

function slug(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "file";
}

export async function POST(request: Request) {
  try {
    await requireUser();

    const formData = await request.formData();
    const file = formData.get("file");
    const requestId = formData.get("requestId") as string | null;
    const budgetPeriod = formData.get("budgetPeriod") as string | null;
    const documentType = (formData.get("documentType") as string | null) ?? "";

    if (!(file instanceof File) || !requestId || !budgetPeriod) {
      return NextResponse.json(
        { success: false, error: "file, requestId, and budgetPeriod are required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    // <budget_period>/<request_id>/<document_type>_<timestamp>_<filename> —
    // mirrors the folder-per-request layout the Drive integration used
    // (without re-prefixing the bucket's own name into the object path,
    // which the bucket already namespaces).
    const path = `${slug(budgetPeriod)}/${slug(requestId)}/${slug(documentType || "file")}_${Date.now()}_${slug(file.name)}`;

    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: signedData, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signedData) throw signError ?? new Error("Failed to create signed URL");

    return NextResponse.json({ success: true, url: signedData.signedUrl, path, fileName: file.name });
  } catch (err) {
    return handleApiError(err);
  }
}
