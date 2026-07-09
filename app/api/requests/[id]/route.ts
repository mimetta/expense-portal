import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canViewRequest, hasRole, isSuperadmin, visibleRejectionHistory } from "@/lib/permissions";
import { isBoActionable, isCeoActionable, isEditApproved, isOwnerEditable } from "@/lib/status";
import { getRequestOrThrow, updateRequest } from "@/lib/request-repo";
import { computeTotals } from "@/lib/totals";
import { logAudit } from "@/lib/audit";
import { notify, type NotificationEvent } from "@/lib/discord";
import { buildEditableFields, resubmitRequest, type EditableRequestBody } from "@/lib/resubmit";
import type { ExpenseRequest, FileEntry, RequestItem } from "@/types/database";

// status_before_edit is always one of these three — canRequestEdit
// (lib/status.ts) only allows requesting an edit from BO_APPROVED/
// CEO_APPROVED/PAID in the first place.
const EDIT_RESUBMIT_NOTIFY_EVENT: Record<string, NotificationEvent> = {
  BO_APPROVED: "BO_APPROVED",
  CEO_APPROVED: "CEO_APPROVED",
  PAID: "PAID",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("requests")
      .select("*")
      .eq("request_id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const requestRow = data as ExpenseRequest;
    if (!canViewRequest(user, requestRow)) throw new ForbiddenError();

    return NextResponse.json({
      request: {
        ...requestRow,
        rejection_history: visibleRejectionHistory(requestRow.rejection_history, user),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

interface ProcurementEditBody {
  items_json?: RequestItem[];
  supplier_name?: string;
  pay_method?: string;
  bank_name?: string;
  card_type?: string;
  account_no?: string;
  due_date?: string;
  credit_term_days?: number;
  slip_receiver_email?: string;
  po_number?: string;
  po_date?: string;
  po_vendor?: string;
  po_delivery_date?: string;
  po_notes?: string;
  files_json?: FileEntry[];
}

// Procurement's inline edit is intentionally narrow: item Net/VAT/WHT (via
// items_json), payment fields, and PO details only — everything else on the
// request (department, expense type, category, etc.) is read-only from this
// path. Totals are always recomputed server-side from items_json, never
// trusted from the client.
//
// Entering a PO Number here replaces the old separate "Upload PO" action:
// if the request is still SUBMITTED (no PO uploaded yet) and a non-blank
// po_number is provided, status auto-advances to PO_UPLOADED and
// po_uploaded_by/po_uploaded_at are stamped, same as the dedicated
// /api/requests/[id]/po route did.
function buildProcurementPatch(body: ProcurementEditBody, existing: ExpenseRequest, actorEmail: string) {
  const items =
    Array.isArray(body.items_json) && body.items_json.length > 0 ? body.items_json : existing.items_json;
  const totals = computeTotals(items);

  const autoUploadsPo =
    existing.status === "SUBMITTED" && !existing.po_uploaded_at && !!body.po_number?.trim();

  return {
    items_json: items,
    items_summary: totals.items_summary,
    items_count: totals.items_count,
    amount_net: totals.amount_net,
    vat_rate: totals.vat_rate,
    vat_amount: totals.vat_amount,
    wht_rate: totals.wht_rate,
    wht_amount: totals.wht_amount,
    total: totals.total,
    supplier_name: body.supplier_name ?? existing.supplier_name,
    pay_method: body.pay_method ?? existing.pay_method,
    bank_name: body.bank_name ?? existing.bank_name,
    card_type: body.card_type ?? existing.card_type,
    account_no: body.account_no ?? existing.account_no,
    due_date: body.due_date ?? existing.due_date,
    credit_term_days: body.credit_term_days ?? existing.credit_term_days,
    slip_receiver_email: body.slip_receiver_email ?? existing.slip_receiver_email,
    po_number: body.po_number ?? existing.po_number,
    po_date: body.po_date ?? existing.po_date,
    po_vendor: body.po_vendor ?? existing.po_vendor,
    po_delivery_date: body.po_delivery_date ?? existing.po_delivery_date,
    po_notes: body.po_notes ?? existing.po_notes,
    files_json: Array.isArray(body.files_json) ? body.files_json : existing.files_json,
    ...(autoUploadsPo
      ? { status: "PO_UPLOADED" as const, po_uploaded_by: actorEmail, po_uploaded_at: new Date().toISOString() }
      : {}),
  };
}

// Six things happen through this single endpoint, mutually exclusive by
// status/body shape:
//   1. { resubmit: true, ...editable fields }  — REJECTED only, steps the
//      status back one stage (see lib/resubmit.ts). Requester or SUPERADMIN.
//   2. { attach_signature: true, files_json }  — BO/CEO attaching a
//      signed PDF (already rendered/stamped/uploaded to Storage client-side
//      — see components/shared/PDFSigner.tsx) during their own actionable
//      stage. Only files_json changes.
//   3. { owner_edit: true, ...editable fields } — requester freely editing
//      their own request's full content while it's still untouched by
//      Procurement (see lib/status.ts#isOwnerEditable: SUBMITTED and no
//      po_number/po_uploaded_by/po_uploaded_at). Status unchanged. Requester
//      or SUPERADMIN. Reuses the same buildEditableFields as resubmit/#5
//      below. Logged as REQUEST_EDITED. Needs this explicit flag (rather
//      than inferring from status the way #5 does) because SUPERADMIN can
//      also satisfy #4's canProcurementEdit check at the same status
//      (SUBMITTED) — without a flag, an owner's full-form edit could be
//      silently misrouted into buildProcurementPatch's narrow field
//      whitelist and lose most of the edit.
//   4. Procurement inline edit (RequestDetailModal on /procurement) — only
//      while the request is still in Procurement's own window (SUBMITTED
//      or PO_UPLOADED). PROCUREMENT role or SUPERADMIN. Narrow field
//      whitelist (see buildProcurementPatch). Logged as PROCUREMENT_EDIT.
//   5. Owner editing a REJECTED request's content without resubmitting yet
//      (status unchanged) — same full field set as resubmit/#3, minus the
//      status/rejection-marker changes. Requester or SUPERADMIN. Logged as
//      REQUEST_EDITED. No explicit flag needed: REJECTED never overlaps
//      with #4's SUBMITTED/PO_UPLOADED gate, so there's no ambiguity here.
//   6. { edit_resubmit: true, ...editable fields } — the Edit Request
//      approval workflow's own resubmit (see request-edit/route.ts and
//      approve-edit/route.ts for steps 1-2): only once an approver has
//      granted the request (status EDIT_REQUESTED, edit_approved_by set —
//      lib/status.ts#isEditApproved). Same full field set as #1/#3/#5 via
//      buildEditableFields, but the target status is status_before_edit
//      (stamped by approve-edit, not rejected_stage) and all five edit_*
//      markers are cleared. Logged as EDIT_RESUBMITTED.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);
    const body = (await request.json()) as EditableRequestBody &
      ProcurementEditBody & {
        resubmit?: boolean;
        attach_signature?: boolean;
        owner_edit?: boolean;
        edit_resubmit?: boolean;
        files_json?: FileEntry[];
      };

    if (body.resubmit === true) {
      const updated = await resubmitRequest(admin, existing, user, body);
      return NextResponse.json({ request: updated });
    }

    // Narrowest branch in this route: BO/CEO attaching a signed PDF
    // (see components/shared/PDFSigner.tsx) during their own actionable
    // stage. Only ever touches files_json — nothing else on the request.
    if (body.attach_signature === true) {
      const canSign =
        isSuperadmin(user) ||
        (hasRole(user, "BO") && isBoActionable(existing)) ||
        (hasRole(user, "CEO") && isCeoActionable(existing));
      if (!canSign) throw new ForbiddenError();
      if (!Array.isArray(body.files_json)) {
        return NextResponse.json({ error: "files_json array is required" }, { status: 400 });
      }
      const updated = await updateRequest(admin, id, { files_json: body.files_json });
      await logAudit(user.email, id, "SIGNATURE_ATTACHED", {});
      return NextResponse.json({ request: updated });
    }

    if (body.edit_resubmit === true) {
      const canEditResubmit =
        isEditApproved(existing) && (existing.requester_email === user.email || isSuperadmin(user));
      if (!canEditResubmit) {
        return NextResponse.json(
          { error: "Cannot resubmit — no approved edit request for this request" },
          { status: 403 },
        );
      }
      const targetStatus = (existing.status_before_edit as ExpenseRequest["status"] | null) ?? "SUBMITTED";
      const editableFields = await buildEditableFields(admin, body, existing);
      const updated = await updateRequest(admin, id, {
        ...editableFields,
        status: targetStatus,
        edit_requested_at: null,
        edit_requested_reason: null,
        edit_approved_by: null,
        edit_approved_at: null,
        status_before_edit: null,
      });
      await logAudit(user.email, id, "EDIT_RESUBMITTED", { target_status: targetStatus });
      const notifyEvent = EDIT_RESUBMIT_NOTIFY_EVENT[targetStatus];
      if (notifyEvent) await notify(notifyEvent, updated);
      return NextResponse.json({ request: updated });
    }

    if (body.owner_edit === true) {
      const canOwnerEditNow =
        isOwnerEditable(existing) && (existing.requester_email === user.email || isSuperadmin(user));
      if (!canOwnerEditNow) {
        return NextResponse.json(
          { error: "Cannot edit — request is already being processed" },
          { status: 403 },
        );
      }
      const patch = await buildEditableFields(admin, body, existing);
      const updated = await updateRequest(admin, id, patch);
      await logAudit(user.email, id, "REQUEST_EDITED", {});
      return NextResponse.json({ request: updated });
    }

    const canProcurementEdit =
      (existing.status === "SUBMITTED" || existing.status === "PO_UPLOADED") &&
      (isSuperadmin(user) || hasRole(user, "PROCUREMENT"));

    if (canProcurementEdit) {
      const patch = buildProcurementPatch(body, existing, user.email);
      const updated = await updateRequest(admin, id, patch);
      await logAudit(user.email, id, "PROCUREMENT_EDIT", {});
      if (patch.status === "PO_UPLOADED") {
        await logAudit(user.email, id, "PO_UPLOADED", { po_number: patch.po_number });
        await notify("PO_UPLOADED", updated);
      }
      return NextResponse.json({ request: updated });
    }

    const canOwnerEditRejected =
      existing.status === "REJECTED" && (existing.requester_email === user.email || isSuperadmin(user));

    if (canOwnerEditRejected) {
      const patch = await buildEditableFields(admin, body, existing);
      const updated = await updateRequest(admin, id, patch);
      await logAudit(user.email, id, "REQUEST_EDITED", {});
      return NextResponse.json({ request: updated });
    }

    throw new ForbiddenError();
  } catch (err) {
    return handleApiError(err);
  }
}

// Owner (or SUPERADMIN) deleting their own request outright — only while
// it's still untouched by Procurement, i.e. the exact same window as
// isOwnerEditable (lib/status.ts): status SUBMITTED and no po_number/
// po_uploaded_by/po_uploaded_at set yet. A hard delete, not a status
// change — nothing downstream (BO/CEO/Accounting) has ever seen this
// request, so there's no approval record to preserve the way REJECTED
// keeps one; the audit_log row (logged before the delete, per the
// standard requireUser -> check -> mutate -> logAudit order) is the only
// remaining trace.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    const canDelete =
      (existing.requester_email === user.email || isSuperadmin(user)) &&
      existing.status === "SUBMITTED" &&
      !existing.po_number?.trim() &&
      !existing.po_uploaded_by?.trim() &&
      !existing.po_uploaded_at;

    if (!canDelete) throw new ForbiddenError();

    await logAudit(user.email, id, "DELETE_REQUEST", {});

    const { error } = await admin.from("requests").delete().eq("request_id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
