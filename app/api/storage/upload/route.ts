import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

// Generic by shape (FormData: file + filename + bucket), but each bucket
// this route will actually write to is allowlisted with its own role
// check, matching who can reach that upload client-side — this route isn't
// meant to become an arbitrary-storage-write endpoint for buckets nobody's
// asked for yet.
const BUCKET_ROLES: Record<
  string,
  ("SUPERADMIN" | "BO" | "CEO" | "ACCOUNTING" | "PROCUREMENT" | "PETTY_CASH_CUSTODIAN" | "EMPLOYEE")[]
> = {
  // components/shared/PDFSigner.tsx — signing during BO/CEO's own actionable
  // stage. application/pdf-only bucket (see CLAUDE.md "PDF document
  // signing") — do not point PNG/other uploads at this one.
  "signed-documents": ["SUPERADMIN", "BO", "CEO"],
  // Settings > Announcements attachment — same roles as the announcements
  // mutation endpoints (see CLAUDE.md "Settings tab permissions").
  announcements: ["SUPERADMIN", "CEO"],
  // components/shared/PrintSignaturePad.tsx — the print view's canvas
  // signature pad (app/print/[id]), image/png-only bucket. A separate
  // bucket from signed-documents (which is PDF-only) — the two upload
  // different mime types for different features, so widening
  // signed-documents' allowlist instead of adding this one would have
  // meant loosening a bucket that's deliberately PDF-only. Three signature
  // boxes are Requester/BO-or-PettyCashHolder/Accounting; EMPLOYEE is
  // included so any requester can sign their own box there.
  signatures: ["SUPERADMIN", "BO", "CEO", "ACCOUNTING", "PETTY_CASH_CUSTODIAN", "EMPLOYEE"],
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const formData = await request.formData();
    const file = formData.get("file");
    const bucket = formData.get("bucket");
    const filenameField = formData.get("filename");

    if (!(file instanceof Blob) || typeof bucket !== "string" || typeof filenameField !== "string") {
      return NextResponse.json({ error: "file, filename, and bucket are required" }, { status: 400 });
    }
    const allowedRoles = BUCKET_ROLES[bucket];
    if (!allowedRoles) {
      return NextResponse.json({ error: `Bucket "${bucket}" is not allowed` }, { status: 400 });
    }
    if (!hasAnyRole(user, allowedRoles)) throw new ForbiddenError();

    const admin = createAdminClient();
    const path = `${Date.now()}_${filenameField.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await admin.storage.from(bucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw error;

    const { data } = admin.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (err) {
    return handleApiError(err);
  }
}
