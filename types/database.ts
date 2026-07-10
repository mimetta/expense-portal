import type { BusinessUnit, Department, Role, Status } from "@/lib/constants";

export interface RejectionHistoryEntry {
  stage: string;
  actor_email: string;
  reason: string;
  rejected_at: string;
}

export interface RequestItem {
  description: string;
  amount_net: number;
  vat_rate: number;
  wht_rate: number;
  cat_l1?: string;
  cat_l2?: string;
  // Per-item Branch (Retail) or Product (R&D), only shown/used for
  // Department = Retail or R&D + Expense Type = เบิกเงินสดย่อย (Petty
  // cash) — see RequestForm.tsx#perItemFieldMode. Every other
  // Retail/R&D expense type keeps a single top-level `requests.product`
  // field instead (see RequestForm.tsx's top-level Branch/Product field).
  product?: string;
  product_code?: string | null;
}

export interface FileEntry {
  name: string;
  url: string;
  size?: number;
  doc_type?: string;
}

export interface ExpenseRequest {
  request_id: string;
  timestamp: string;
  requester_email: string;
  requester_name: string;
  bu: BusinessUnit;
  expense_type: string;
  urgent_reason: string | null;
  department: Department | string;
  budget_period: string;
  product: string | null;
  cat_l1: string | null;
  cat_l2: string | null;
  description: string | null;
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  wht_rate: number;
  wht_amount: number;
  total: number;
  supplier_name: string | null;
  pay_method: string | null;
  bank_name: string | null;
  card_type: string | null;
  pay_ref: string | null;
  account_no: string | null;
  credit_term_days: number | null;
  due_date: string | null;
  slip_receiver_email: string | null;
  status: Status;
  files_folder_url: string | null;
  files_json: FileEntry[];
  requires_po: boolean;
  po_number: string | null;
  po_date: string | null;
  po_vendor: string | null;
  po_delivery_date: string | null;
  po_notes: string | null;
  po_uploaded_by: string | null;
  po_uploaded_at: string | null;
  bo_approver: string | null;
  bo_approved_at: string | null;
  ceo_approver: string | null;
  ceo_approved_at: string | null;
  ceo_signature_required: boolean | null;
  accounting_user: string | null;
  paid_at: string | null;
  rejected_by: string | null;
  rejected_stage: string | null;
  reject_reason: string | null;
  rejected_at: string | null;
  rejection_history: RejectionHistoryEntry[];
  resubmit_count: number;
  last_resubmitted_at: string | null;
  items_json: RequestItem[];
  items_summary: string | null;
  items_count: number;
  product_code: string | null;
  skip_bo: boolean;
  skip_ceo: boolean;
  // Edit Request approval workflow (see CLAUDE.md) — set when the owner
  // requests permission to edit a BO_APPROVED/CEO_APPROVED/PAID request.
  // status_before_edit captures the status to restore on resubmit, same
  // role rejected_stage plays for the REJECTED/resubmit flow.
  edit_requested_at: string | null;
  edit_requested_reason: string | null;
  edit_approved_by: string | null;
  edit_approved_at: string | null;
  status_before_edit: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  id: string;
  email: string;
  role: Role;
  bu_scope: string;
  dept_scope: string;
  cat_l1_scope: string;
  created_at: string;
  is_auto_registered: boolean;
}

export interface DeptConfigRow {
  id: string;
  dept: string;
  bu: string;
  cat_l1: string;
  bo_email: string | null;
  exceed_amount: number;
  ceo_signature_required: boolean;
  skip_ceo: boolean;
  skip_bo: boolean;
}

export interface CategoryRow {
  id: string;
  bu: string;
  department: string;
  product: string | null;
  cat_l1: string | null;
  cat_l2: string | null;
}

export interface CurrentUser {
  email: string;
  name: string;
  allRoles: RoleRow[];
}

export interface SupplierRow {
  id: number;
  name: string;
  payment_method: string | null;
  bank_name: string | null;
  account_no: string | null;
  notes: string | null;
  created_at: string;
}

export interface ProductRow {
  id: number;
  sku_code: string | null;
  product_name: string;
  department: string | null;
  bu: string | null;
  created_at: string;
}

export interface AnnouncementRow {
  id: number;
  title: string;
  message: string | null;
  is_pinned: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  attachment_url: string | null;
  attachment_type: string | null;
}

export type CalendarEventType = "payment" | "deadline" | "reminder" | "important" | "general";

export interface CalendarEventRow {
  id: number;
  title: string;
  description: string | null;
  event_date: string;
  event_type: CalendarEventType;
  created_by: string;
  created_at: string;
}
