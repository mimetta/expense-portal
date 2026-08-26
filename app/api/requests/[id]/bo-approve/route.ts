import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import {
  canBoActOnRequest,
  computeCeoSignatureRequired,
  hasRole,
  isSuperadmin,
  matchDeptConfig,
} from "@/lib/permissions";
import { isBoActionable } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import { notifyInApp } from "@/lib/notifications";
import type { DeptConfigRow } from "@/types/database";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "BO")) {
      throw new ForbiddenError();
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (!isBoActionable(existing)) {
      throw new ConflictError(
        `Request ${id} is not awaiting BO approval (status: ${existing.status}, skip_bo: ${existing.skip_bo})`,
      );
    }
    // Petty cash custodians no longer approve directly through this route —
    // their sign-off is a separate, earlier step (see
    // PATCH /api/requests/[id]/petty-cash-approve), which is also what
    // isBoActionable now requires before a petty cash request even reaches
    // here. Only a real in-scope BO (or SUPERADMIN) can act on this route —
    // if that same person is also the assigned custodian, petty-cash-approve
    // folds this transition into their one sign-off click instead.
    if (!isSuperadmin(user) && !canBoActOnRequest(user, existing)) {
      throw new ForbiddenError("This request is outside your BO scope");
    }

    // CEO signature requirement is finalized here, per the documented rule
    // that the check happens at BO-approval time.
    const { data: deptConfigs, error: dcError } = await admin.from("dept_config").select("*");
    if (dcError) throw dcError;
    const matched = matchDeptConfig(deptConfigs as DeptConfigRow[], {
      bu: existing.bu,
      department: existing.department,
      cat_l1: existing.cat_l1,
    });
    const ceoSignatureRequired = computeCeoSignatureRequired(matched, existing.total);

    const updated = await updateRequest(admin, id, {
      status: "BO_APPROVED",
      bo_approver: user.email,
      bo_approved_at: new Date().toISOString(),
      ceo_signature_required: ceoSignatureRequired,
    });

    await logAudit(user.email, id, "BO_APPROVED", {});
    await notify("BO_APPROVED", updated);
    await notifyInApp("BO_APPROVED", updated);

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
