import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import {
  canBoActOnRequest,
  canPettyCashActOnRequest,
  computeCeoSignatureRequired,
  hasRole,
  isSuperadmin,
  matchDeptConfig,
} from "@/lib/permissions";
import { isPettyCashApprovable } from "@/lib/status";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import { notifyInApp } from "@/lib/notifications";
import type { DeptConfigRow } from "@/types/database";

// Custodian sign-off — a distinct step from BO_APPROVED, not a substitute
// for it (see migration 018 and lib/status.ts#isPettyCashApprovable for the
// full reasoning). Three scenarios all need this same two-signoff chain:
//   1. A pure custodian (no BO role) submitting/approving their own petty
//      cash request — the segment's real BO still has to approve after
//      this, they don't get skipped just because the custodian is also the
//      requester.
//   2. A custodian who also holds an in-scope BO role — they shouldn't
//      have to click Approve twice for the same request, so if they're
//      also the in-scope BO, this single call folds the BO_APPROVED
//      transition in too (or, on the skip_bo path, there's no separate BO
//      step to fold in at all — sign-off alone unlocks CEO).
//   3. An employee (no custodian role) submitting through someone else's
//      petty cash fund — same chain, just with a different requester;
//      nothing here special-cases who submitted the request.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "PETTY_CASH_CUSTODIAN")) {
      throw new ForbiddenError();
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (!isPettyCashApprovable(existing)) {
      throw new ConflictError(
        `Request ${id} is not awaiting petty cash sign-off (status: ${existing.status}, ` +
          `already signed off: ${!!existing.petty_cash_approved_by})`,
      );
    }
    if (!isSuperadmin(user) && !canPettyCashActOnRequest(user, existing)) {
      throw new ForbiddenError("You are not the assigned petty cash holder for this request");
    }

    const patch: Record<string, unknown> = {
      petty_cash_approved_by: user.email,
      petty_cash_approved_at: new Date().toISOString(),
    };

    // Fold the BO_APPROVED transition into this same click when the signer
    // is also an in-scope BO — see scenario 2 above. Not applicable at all
    // on the skip_bo path: there's no separate BO step to fold in, sign-off
    // alone already unlocks CEO (see isCeoActionable's skip_bo branch).
    const alsoBo = !existing.skip_bo && (isSuperadmin(user) || (hasRole(user, "BO") && canBoActOnRequest(user, existing)));
    let deptConfigMatchError: unknown = null;
    if (alsoBo) {
      const { data: deptConfigs, error: dcError } = await admin.from("dept_config").select("*");
      if (dcError) deptConfigMatchError = dcError;
      else {
        const matched = matchDeptConfig(deptConfigs as DeptConfigRow[], {
          bu: existing.bu,
          department: existing.department,
          cat_l1: existing.cat_l1,
        });
        patch.status = "BO_APPROVED";
        patch.bo_approver = user.email;
        patch.bo_approved_at = new Date().toISOString();
        patch.ceo_signature_required = computeCeoSignatureRequired(matched, existing.total);
      }
    }
    if (deptConfigMatchError) throw deptConfigMatchError;

    const updated = await updateRequest(admin, id, patch);

    await logAudit(user.email, id, "PETTY_CASH_APPROVED", { also_bo_approved: !!patch.status });
    if (patch.status === "BO_APPROVED") {
      await logAudit(user.email, id, "BO_APPROVED", {});
      await notify("BO_APPROVED", updated);
      await notifyInApp("BO_APPROVED", updated);
    } else {
      await notifyInApp("PETTY_CASH_APPROVED", updated);
    }

    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
