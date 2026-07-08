import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { needsProcurement } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import type { FileEntry } from "@/types/database";

interface UploadPoBody {
  po_number: string;
  po_date: string;
  po_vendor: string;
  po_delivery_date?: string;
  po_notes?: string;
  files_folder_url?: string;
  files_json?: FileEntry[];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "PROCUREMENT")) {
      throw new ForbiddenError();
    }

    const { id } = await params;
    const body = (await request.json()) as UploadPoBody;
    if (!body.po_number || !body.po_date || !body.po_vendor) {
      return NextResponse.json(
        { error: "po_number, po_date, and po_vendor are required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (!needsProcurement(existing)) {
      throw new ConflictError(
        `Request ${id} is not awaiting a PO (status: ${existing.status})`,
      );
    }

    const updated = await updateRequest(admin, id, {
      status: "PO_UPLOADED",
      po_number: body.po_number,
      po_date: body.po_date,
      po_vendor: body.po_vendor,
      po_delivery_date: body.po_delivery_date ?? null,
      po_notes: body.po_notes ?? null,
      po_uploaded_by: user.email,
      po_uploaded_at: new Date().toISOString(),
      files_folder_url: body.files_folder_url ?? existing.files_folder_url,
      files_json: body.files_json ?? existing.files_json,
    });

    await logAudit(user.email, id, "PO_UPLOADED", { po_number: body.po_number });
    await notify("PO_UPLOADED", updated);

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
