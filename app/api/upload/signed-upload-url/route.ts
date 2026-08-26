import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Mints a signed upload URL/token for the private "attachments" bucket so
// the browser can upload the file bytes directly to Supabase Storage,
// bypassing Vercel's serverless function body-size limit (~4.5MB) that
// POST /api/upload (the old proxy-through-the-function route, left in
// place — see CLAUDE.md "File Storage") was silently hitting on anything
// larger. Only a small JSON request/response goes through this function;
// the file itself never does. Same auth/path-construction/allowlist logic
// as the old route, just split so validation + token issuance happens
// before the file is sent, not after.
const BUCKET = "attachments";

// Mirrors the live "attachments" bucket's own config (file_size_limit /
// allowed_mime_types, confirmed via the Storage API) so a bad request gets
// a clear error immediately instead of failing later, mid-upload, with
// Supabase Storage's own less specific rejection. Not the enforcement
// boundary — the bucket enforces these regardless of how a file reaches it
// — just a fast, friendly early check.
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function slug(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "file";
}

export async function POST(request: Request) {
  try {
    await requireUser();

    const body = await request.json().catch(() => ({}));
    const { requestId, budgetPeriod, documentType, fileName, fileSize, mimeType } = body as {
      requestId?: string;
      budgetPeriod?: string;
      documentType?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
    };

    if (!requestId || !budgetPeriod || !fileName) {
      return NextResponse.json(
        { success: false, error: "requestId, budgetPeriod, and fileName are required" },
        { status: 400 },
      );
    }

    if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: `${fileName} exceeds the 50MB attachment size limit` },
        { status: 400 },
      );
    }

    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, error: `${fileName} has an unsupported file type (${mimeType})` },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    // Same <budget_period>/<request_id>/<document_type>_<timestamp>_
    // <filename> convention as the old route (app/api/upload/route.ts) —
    // downstream code (resolveFileUrl, GET /api/upload/signed-url) doesn't
    // care which route produced a given path, only that it's a real object
    // in this bucket.
    const path = `${slug(budgetPeriod)}/${slug(requestId)}/${slug(documentType || "file")}_${Date.now()}_${slug(fileName)}`;

    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("Failed to create signed upload URL");

    return NextResponse.json({ success: true, path, token: data.token });
  } catch (err) {
    return handleApiError(err);
  }
}
