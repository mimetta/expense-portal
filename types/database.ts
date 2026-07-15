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
  // Per-item Segment — replaces the old single top-level Basic Info
  // Segment field (removed; see CLAUDE.md "Multi-Item Requests"). Each row
  // picks its own Segment independently, same source (/api/departments) as
  // the old top-level field used. requests.department (used by dept_config
  // matching / BO scope filtering) is still populated from the first item's
  // segment, same "first item wins on a mismatch" convention already
  // documented for cat_l1/cat_l2.
  segment?: string;
  // Per-item Travel by (เบิกค่าเดินทาง only) — see lib/constants.ts
  // TRAVEL_BY_OPTIONS. distance_km only applies to the personal-vehicle
  // option; Net Amount is auto-calculated from it (distance_km * 8) rather
  // than stored as a separate value, so there's no redundant "auto" flag to
  // keep in sync — RequestForm.tsx recomputes amount_net directly.
  travel_by?: string;
  distance_km?: number;
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
  // Snapshot of requester_email's roles.chapter at submission time (see
  // "Chapter field" in CLAUDE.md) — not joined live, same convention as
  // requester_name/requester_email.
  chapter: string | null;
  // Which companies.bu this expense is billed to — independent of `bu`
  // above (the submitter's own BU scope). Set from the Basic Info "Use for
  // company" dropdown, always visible regardless of expense type.
  use_for_company: string | null;
  // Snapshot of the selected petty_cash_custodians.email at submission
  // time (same copy-not-join convention as chapter/requester_name) — only
  // set for PETTY_CASH_LABEL requests.
  petty_cash_holder_email: string | null;
  // Flat convenience copy of items_json entries that have a travel_by set;
  // items_json itself remains the source of truth (see RequestItem).
  travel_items: { travel_by: string; distance_km: number | null }[];
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
  chapter: string | null;
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
  // Derived in lib/auth.ts#getCurrentUser from allRoles (first non-empty
  // chapter across the user's roles rows) — not a column on any table
  // this type otherwise mirrors 1:1.
  chapter: string | null;
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

export interface CompanyRow {
  id: number;
  bu: string;
  name_en: string;
  name_th: string | null;
  address: string;
  created_at: string;
}

export interface PettyCashCustodianRow {
  id: number;
  name: string;
  email: string;
  company: string;
  segment: string;
  amount_limit: number;
  is_active: boolean;
  created_at: string;
}

export interface DraftRow {
  id: number;
  owner_email: string;
  title: string | null;
  form_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
