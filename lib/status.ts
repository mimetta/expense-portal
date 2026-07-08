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
