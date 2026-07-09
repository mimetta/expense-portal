import type { SupabaseClient } from "@supabase/supabase-js";
import { ForbiddenError } from "@/lib/auth";
import { computeCeoSignatureRequired, isSuperadmin, matchDeptConfig } from "@/lib/permissions";
import { canResubmit } from "@/lib/status";
import { updateRequest, ConflictError } from "@/lib/request-repo";
import { computeTotals } from "@/lib/totals";
import { getExpenseTypeConfig } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { notify, type NotificationEvent } from "@/lib/discord";
import type { CurrentUser, DeptConfigRow, ExpenseRequest, FileEntry, RequestItem } from "@/types/database";

// Shared by PATCH /api/requests/[id] (resubmit: true) and the dedicated
// PATCH /api/requests/[id]/resubmit route (kept as a thin wrapper for
// backward compatibility) — see CLAUDE.md "Rejection & Resubmit".
export interface EditableRequestBody {
  bu?: string;
  expense_type?: string;
  urgent_reason?: string;
  department?: string;
  budget_period?: string;
  product?: string;
  cat_l1?: string;
  cat_l2?: string;
  description?: string;
  items?: RequestItem[];
  supplier_name?: string;
  pay_method?: string;
  bank_name?: string;
  card_type?: string;
  account_no?: string;
  pay_ref?: string;
  credit_term_days?: number;
  due_date?: string;
  slip_receiver_email?: string;
  requires_po?: boolean;
  files_folder_url?: string;
  files_json?: FileEntry[];
}

// Builds the full set of submit-page-equivalent fields from a partial edit
// body layered over the existing request — used both for a plain in-place
// edit (status unchanged) and as the base for a resubmit (status changed on
// top of this). Recomputes totals/skip_bo/skip_ceo/ceo_signature_required
// from the (possibly edited) items/department/bu, same as at submission.
export async function buildEditableFields(
  admin: SupabaseClient,
  body: EditableRequestBody,
  existing: ExpenseRequest,
) {
  const bu = body.bu ?? existing.bu;
  const department = body.department ?? existing.department;
  const items = body.items && body.items.length > 0 ? body.items : existing.items_json;
  const totals = computeTotals(items);
  const expenseType = body.expense_type ?? existing.expense_type;
  const expenseTypeConfig = getExpenseTypeConfig(expenseType);
  const cat_l1 = body.cat_l1 ?? items[0]?.cat_l1 ?? existing.cat_l1;

  const { data: deptConfigs, error: dcError } = await admin.from("dept_config").select("*");
  if (dcError) throw dcError;
  const matched = matchDeptConfig(deptConfigs as DeptConfigRow[], { bu, department, cat_l1 });
  const skipBo = matched?.skip_bo ?? false;
  const skipCeo = matched?.skip_ceo ?? false;
  const ceoSignatureRequired = computeCeoSignatureRequired(matched, totals.total);

  return {
    bu,
    expense_type: expenseType,
    urgent_reason: expenseTypeConfig?.isUrgent ? body.urgent_reason ?? existing.urgent_reason : null,
    department,
    budget_period: body.budget_period ?? existing.budget_period,
    product: body.product ?? existing.product,
    cat_l1,
    cat_l2: body.cat_l2 ?? items[0]?.cat_l2 ?? existing.cat_l2,
    description: body.description ?? existing.description,
    amount_net: totals.amount_net,
    vat_rate: totals.vat_rate,
    vat_amount: totals.vat_amount,
    wht_rate: totals.wht_rate,
    wht_amount: totals.wht_amount,
    total: totals.total,
    supplier_name: expenseTypeConfig?.hidePaymentSection ? null : body.supplier_name ?? existing.supplier_name,
    pay_method: expenseTypeConfig?.hidePaymentSection ? null : body.pay_method ?? existing.pay_method,
    bank_name:
      expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
        ? null
        : body.bank_name ?? existing.bank_name,
    card_type:
      expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
        ? null
        : body.card_type ?? existing.card_type,
    account_no:
      expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
        ? null
        : body.account_no ?? existing.account_no,
    pay_ref:
      expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
        ? null
        : body.pay_ref ?? existing.pay_ref,
    credit_term_days: body.credit_term_days ?? existing.credit_term_days,
    due_date: body.due_date ?? existing.due_date,
    slip_receiver_email: body.slip_receiver_email ?? existing.slip_receiver_email,
    requires_po: body.requires_po ?? existing.requires_po,
    files_folder_url: body.files_folder_url ?? existing.files_folder_url,
    files_json: body.files_json ?? existing.files_json,
    items_json: items,
    items_summary: totals.items_summary,
    items_count: totals.items_count,
    skip_bo: skipBo,
    skip_ceo: skipCeo,
    ceo_signature_required: ceoSignatureRequired,
  };
}

// rejected_stage is captured (see reject/route.ts) as `existing.status` at
// the moment of rejection — i.e. the status the request was already
// resting in, one stage short of the reviewer who rejected it. Restoring
// that value is exactly "step backward by one stage".
export function resubmitTargetStatus(existing: ExpenseRequest): ExpenseRequest["status"] {
  return (existing.rejected_stage as ExpenseRequest["status"] | null) ?? "SUBMITTED";
}

// resubmitTargetStatus realistically only ever returns one of the first
// four (a rejection's rejected_stage is always a pre-rejection stage) —
// PAID/REJECTED/EDIT_REQUESTED are included only so this Record stays
// exhaustively typed against the full Status union; they'll never actually
// be looked up here.
const NOTIFY_EVENT_FOR_STATUS: Record<ExpenseRequest["status"], NotificationEvent> = {
  SUBMITTED: "SUBMITTED",
  PO_UPLOADED: "PO_UPLOADED",
  BO_APPROVED: "BO_APPROVED",
  CEO_APPROVED: "CEO_APPROVED",
  PAID: "PAID",
  REJECTED: "REJECTED",
  EDIT_REQUESTED: "EDIT_REQUESTED",
};

export async function resubmitRequest(
  admin: SupabaseClient,
  existing: ExpenseRequest,
  user: CurrentUser,
  body: EditableRequestBody,
): Promise<ExpenseRequest> {
  if (existing.requester_email !== user.email && !isSuperadmin(user)) {
    throw new ForbiddenError();
  }
  if (existing.status !== "REJECTED") {
    throw new ConflictError(`Request ${existing.request_id} is not rejected (status: ${existing.status})`);
  }
  if (!isSuperadmin(user) && !canResubmit(existing)) {
    throw new ConflictError(
      `The 24-hour resubmit window for ${existing.request_id} has expired — it stays rejected permanently`,
    );
  }

  const editableFields = await buildEditableFields(admin, body, existing);
  const targetStatus = resubmitTargetStatus(existing);

  const updated = await updateRequest(admin, existing.request_id, {
    ...editableFields,
    status: targetStatus,
    // Only the rejection markers are cleared — po_*/bo_*/ceo_* fields for
    // stages already passed are left as-is (see resubmitTargetStatus above).
    rejected_by: null,
    rejected_stage: null,
    reject_reason: null,
    rejected_at: null,
    resubmit_count: existing.resubmit_count + 1,
    last_resubmitted_at: new Date().toISOString(),
  });

  await logAudit(user.email, existing.request_id, "RESUBMITTED", {
    resubmit_count: updated.resubmit_count,
    target_status: targetStatus,
  });
  await notify(NOTIFY_EVENT_FOR_STATUS[targetStatus], updated);

  return updated;
}
