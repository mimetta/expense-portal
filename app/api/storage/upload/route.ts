import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasRole, isSuperadmin } from "@/lib/permissions";

// Generic by shape (FormData: file + filename + bucket) per spec, but only
// components/shared/PDFSigner.tsx calls this today, uploading a signed PDF
// to the 'signed-documents' bucket. The bucket allowlist keeps this from
// becoming an arbitrary-storage-write endpoint; the BO/CEO/SUPERADMIN check
// matches who's actually allowed to reach the Sign flow client-side (see
// isBoActionable/isCeoActionable-gated buttons in RequestDetailModal.tsx).
const ALLOWED_BUCKETS = ["signed-documents"];

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "BO") && !hasRole(user, "CEO")) {
      throw new ForbiddenError();
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const bucket = formData.get("bucket");
    const filenameField = formData.get("filename");

    if (!(file instanceof Blob) || typeof bucket !== "string" || typeof filenameField !== "string") {
      return NextResponse.json({ error: "file, filename, and bucket are required" }, { status: 400 });
    }
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return NextResponse.json({ error: `Bucket "${bucket}" is not allowed` }, { status: 400 });
    }

    const admin = createAdminClient();
    const path = `${Date.now()}_${filenameField.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await admin.storage.from(bucket).upload(path, file, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });
    if (error) throw error;

    const { data } = admin.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (err) {
    return handleApiError(err);
  }
}
