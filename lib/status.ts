import type { ExpenseRequest } from "@/types/database";

// Status flow (see CLAUDE.md):
//   normal:            SUBMITTED -> PO_UPLOADED -> BO_APPROVED -> CEO_APPROVED -> PAID
//   no PO:              SUBMITTED -> BO_APPROVED -> CEO_APPROVED -> PAID
//   skip BO:            SUBMITTED -> PO_UPLOADED -> CEO_APPROVED -> PAID
//   skip BO + no PO:    SUBMITTED -> CEO_APPROVED -> PAID
// requires_po/skip_bo determine which of PO_UPLOADED/BO_APPROVED are ever
// visited; procurement/BO/CEO pages each filter on "is this request
// currently actionable at my stage".

export function needsProcurement(r: ExpenseRequest): boolean {
  return r.requires_po && r.status === "SUBMITTED";
}

export function isBoActionable(r: ExpenseRequest): boolean {
  if (r.skip_bo) return false;
  if (r.requires_po) return r.status === "PO_UPLOADED";
  return r.status === "SUBMITTED";
}

export function isCeoActionable(r: ExpenseRequest): boolean {
  if (r.skip_bo) {
    return r.requires_po ? r.status === "PO_UPLOADED" : r.status === "SUBMITTED";
  }
  return r.status === "BO_APPROVED";
}

export function isAccountingActionable(r: ExpenseRequest): boolean {
  return r.status === "CEO_APPROVED";
}

export function isTerminal(r: ExpenseRequest): boolean {
  return r.status === "PAID" || r.status === "REJECTED";
}

export const STATUS_LABELS: Record<ExpenseRequest["status"], string> = {
  SUBMITTED: "Submitted",
  PO_UPLOADED: "PO Uploaded",
  BO_APPROVED: "BO Approved",
  CEO_APPROVED: "CEO Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  EDIT_REQUESTED: "Edit Requested",
};

// Rejected requests can only be resubmitted within this window of
// rejected_at (see app/api/requests/[id]/resubmit/route.ts).
export const RESUBMIT_WINDOW_HOURS = 24;

export function resubmitDeadline(r: ExpenseRequest): Date | null {
  if (r.status !== "REJECTED" || !r.rejected_at) return null;
  return new Date(new Date(r.rejected_at).getTime() + RESUBMIT_WINDOW_HOURS * 60 * 60 * 1000);
}

export function canResubmit(r: ExpenseRequest): boolean {
  const deadline = resubmitDeadline(r);
  return deadline !== null && Date.now() < deadline.getTime();
}

// The requester can freely edit their own request (full form, not just a
// resubmit) only before Procurement has touched it at all — once any PO
// field is set, the request is "in progress" and locked from owner editing
// until/unless it's later rejected (see canOwnerEditRejected in
// app/api/requests/[id]/route.ts, a separate, pre-existing path).
export function isOwnerEditable(r: ExpenseRequest): boolean {
  return (
    r.status === "SUBMITTED" &&
    !r.po_number?.trim() &&
    !r.po_uploaded_by?.trim() &&
    !r.po_uploaded_at
  );
}

// --- Edit Request approval workflow ---------------------------------------
// A separate, later-stage escape hatch from isOwnerEditable above: once a
// request has already been approved (or paid), the owner can still ask
// permission to edit it, but an approver has to grant that first. See
// CLAUDE.md "Edit Request approval workflow" for the full flow.

const EDIT_REQUESTABLE_STATUSES: ReadonlySet<ExpenseRequest["status"]> = new Set<ExpenseRequest["status"]>([
  "BO_APPROVED",
  "CEO_APPROVED",
  "PAID",
]);

export function canRequestEdit(r: ExpenseRequest): boolean {
  return EDIT_REQUESTABLE_STATUSES.has(r.status) && !r.edit_requested_at;
}

// True from the moment the owner clicks "Request Edit" until an approver
// acts (allow or reject) — status is still whatever it originally was
// (BO_APPROVED/CEO_APPROVED/PAID), not yet EDIT_REQUESTED.
export function isEditRequestPending(r: ExpenseRequest): boolean {
  return !!r.edit_requested_at && r.status !== "EDIT_REQUESTED";
}

// Which stage's approver should see/act on this pending edit request —
// null once it's no longer pending (isEditRequestPending is false) or if
// the status is somehow none of the three edit-requestable ones.
export function editRequestApproverStage(r: ExpenseRequest): "BO" | "CEO" | "ACCOUNTING" | null {
  if (!isEditRequestPending(r)) return null;
  switch (r.status) {
    case "BO_APPROVED":
      return "BO";
    case "CEO_APPROVED":
      return "CEO";
    case "PAID":
      return "ACCOUNTING";
    default:
      return null;
  }
}

// The request is unlocked for full-form owner editing (an approver already
// said yes) — same shape of check as isOwnerEditable, different gate.
export function isEditApproved(r: ExpenseRequest): boolean {
  return r.status === "EDIT_REQUESTED" && !!r.edit_approved_by;
}
