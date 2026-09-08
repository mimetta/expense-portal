import { PETTY_CASH_LABEL } from "@/lib/constants";
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

// Petty cash custodian sign-off — a distinct step from BO_APPROVED, added
// after this scenario was walked through explicitly: a pure custodian, a
// custodian who's also a BO, and an employee borrowing from someone else's
// petty cash fund all need the SAME two sign-offs (custodian, then
// whoever/whatever normally reviews next), collapsing to one click only
// when the same person holds both roles (see
// app/api/requests/[id]/petty-cash-approve/route.ts). Deliberately does
// NOT check skip_bo — the custodian sign-off is always required for a
// petty cash request regardless of whether the BO step itself is skipped
// for that segment; only the step *after* sign-off follows skip_bo.
// requires_po normally decides whether a reviewer waits for PO_UPLOADED or
// acts straight from SUBMITTED — but it isn't a hard gate on PO_UPLOADED
// ever happening: buildProcurementPatch's autoUploadsPo (see PATCH
// /api/requests/[id]) advances status to PO_UPLOADED whenever a po_number
// is entered while status is SUBMITTED, with no requires_po check at all.
// So a requires_po=false request can still end up at PO_UPLOADED in
// practice (Procurement attaching a PO anyway), and every "is this
// reviewer's stage" check below must treat PO_UPLOADED as actionable
// regardless of requires_po, not just when requires_po is true — otherwise
// that request becomes stuck, actionable by no one (confirmed live on
// EXP-2026-09-000005: requires_po false, status PO_UPLOADED after a PO was
// attached anyway, isBoActionable wrongly returned false so BO's Approve
// button 409'd with "not awaiting BO approval").
function isSubmittedOrPoUploaded(r: ExpenseRequest): boolean {
  if (r.status === "PO_UPLOADED") return true;
  return !r.requires_po && r.status === "SUBMITTED";
}

export function isPettyCashApprovable(r: ExpenseRequest): boolean {
  if (r.expense_type !== PETTY_CASH_LABEL) return false;
  if (r.petty_cash_approved_by) return false;
  return isSubmittedOrPoUploaded(r);
}

export function isBoActionable(r: ExpenseRequest): boolean {
  if (r.skip_bo) return false;
  // A petty cash request only reaches the segment's real BO once the
  // custodian has signed off — see isPettyCashApprovable above.
  if (r.expense_type === PETTY_CASH_LABEL && !r.petty_cash_approved_by) return false;
  return isSubmittedOrPoUploaded(r);
}

export function isCeoActionable(r: ExpenseRequest): boolean {
  if (r.skip_bo) {
    // Same custodian-sign-off gate as isBoActionable, just on the skip_bo
    // path where CEO is the very next reviewer after the custodian instead
    // of a real BO.
    if (r.expense_type === PETTY_CASH_LABEL && !r.petty_cash_approved_by) return false;
    return isSubmittedOrPoUploaded(r);
  }
  return r.status === "BO_APPROVED";
}

export function isAccountingActionable(r: ExpenseRequest): boolean {
  return r.status === "CEO_APPROVED";
}

export function isTerminal(r: ExpenseRequest): boolean {
  return r.status === "PAID" || r.status === "REJECTED" || r.status === "EXPIRED";
}

export const STATUS_LABELS: Record<ExpenseRequest["status"], string> = {
  SUBMITTED: "Submitted",
  PO_UPLOADED: "PO Uploaded",
  BO_APPROVED: "BO Approved",
  CEO_APPROVED: "CEO Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  EDIT_REQUESTED: "Edit Requested",
  // Historical only — see lib/constants.ts#STATUSES.
  EXPIRED: "Expired",
};

// Rejected requests can only be resubmitted within a window of
// rejected_at (see app/api/requests/[id]/resubmit/route.ts) — the window's
// length depends on which stage rejected it, not a single flat constant.
// Accounting's rejection (the "payment stage") only ever happens when
// rejected_stage is CEO_APPROVED — that's the one and only stage no other
// role can reject from (Procurement/BO/petty-cash-custodian all act at
// SUBMITTED/PO_UPLOADED, CEO acts at BO_APPROVED or, on the skip_bo path,
// at SUBMITTED/PO_UPLOADED same as BO) — so this single equality check is
// a fully reliable "was this the payment-stage rejection" test with no
// need for a separate stored role/actor column.
export const RESUBMIT_WINDOW_HOURS_ACCOUNTING = 24;
// Every earlier stage (Procurement, petty cash custodian, BO, CEO) gets
// the same, longer window — a requester whose request was rejected before
// it ever reached Accounting has more room to fix and resubmit it.
export const RESUBMIT_WINDOW_HOURS_APPROVAL = 24 * 3;

export function resubmitWindowHours(r: ExpenseRequest): number {
  return r.rejected_stage === "CEO_APPROVED"
    ? RESUBMIT_WINDOW_HOURS_ACCOUNTING
    : RESUBMIT_WINDOW_HOURS_APPROVAL;
}

export function resubmitDeadline(r: ExpenseRequest): Date | null {
  if (r.status !== "REJECTED" || !r.rejected_at) return null;
  return new Date(new Date(r.rejected_at).getTime() + resubmitWindowHours(r) * 60 * 60 * 1000);
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
