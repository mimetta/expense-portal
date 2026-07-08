import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { computeCeoSignatureRequired, hasRole, isSuperadmin, matchDeptConfig } from "@/lib/permissions";
import { isCeoActionable } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import type { DeptConfigRow, FileEntry } from "@/types/database";

// Best-effort metadata rename only — actual file storage lives in Google
// Drive (kept as-is per requirements), which this app does not integrate
// with directly. Renaming here just reflects the "_SIGNED" convention in
// files_json so the portal's file list matches what should exist in Drive.
function markNewestFileSigned(files: FileEntry[]): FileEntry[] {
  if (files.length === 0) return files;
  const next = [...files];
  const last = next[next.length - 1];
  if (!last.name.endsWith("_SIGNED")) {
    next[next.length - 1] = { ...last, name: `${last.name}_SIGNED` };
  }
  return next;
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "CEO")) {
      throw new ForbiddenError();
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (!isCeoActionable(existing)) {
      throw new ConflictError(
        `Request ${id} is not awaiting CEO approval (status: ${existing.status})`,
      );
    }

    let ceoSignatureRequired = existing.ceo_signature_required;
    if (ceoSignatureRequired === null) {
      const { data: deptConfigs, error: dcError } = await admin.from("dept_config").select("*");
      if (dcError) throw dcError;
      const matched = matchDeptConfig(deptConfigs as DeptConfigRow[], {
        bu: existing.bu,
        department: existing.department,
        cat_l1: existing.cat_l1,
      });
      ceoSignatureRequired = computeCeoSignatureRequired(matched, existing.total);
    }

    const updated = await updateRequest(admin, id, {
      status: "CEO_APPROVED",
      ceo_approver: user.email,
      ceo_approved_at: new Date().toISOString(),
      ceo_signature_required: ceoSignatureRequired,
      files_json: ceoSignatureRequired
        ? markNewestFileSigned(existing.files_json)
        : existing.files_json,
    });

    await logAudit(user.email, id, "CEO_APPROVED", { signature_required: ceoSignatureRequired });
    await notify("CEO_APPROVED", updated);

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
