import type { CalendarEventType } from "@/types/database";

export const OLD_EMAIL_DOMAIN = "coroand.co";
export const NEW_EMAIL_DOMAIN = "mimetta.co";

export const BUSINESS_UNITS = ["SV", "ONEST"] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

export const DEPARTMENTS = [
  "Marketing",
  "R&D",
  "Factory",
  "Factory Investment",
  "Store Investment",
  "Operations/Fulfillment",
  "Retail",
  "General Administrative",
  "People & HR & System",
  "Merchandise",
  "OEM",
  "Lab Instrument Investment",
  "COG",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

// Display-only abbreviations shown alongside department names in dropdowns.
export const DEPARTMENT_ABBREV: Partial<Record<Department, string>> = {
  Marketing: "MKT",
  "Factory Investment": "FACINV",
  "Store Investment": "STOREINV",
  "Operations/Fulfillment": "OPF",
  "General Administrative": "GA",
  "Lab Instrument Investment": "RD",
};

export const ROLES = [
  "SUPERADMIN",
  "CEO",
  "ACCOUNTING",
  "BO",
  "PROCUREMENT",
  "PETTY_CASH_CUSTODIAN",
  "EMPLOYEE",
  "DEPT_HEAD",
] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = [
  "SUBMITTED",
  "PO_UPLOADED",
  "BO_APPROVED",
  "CEO_APPROVED",
  "PAID",
  "REJECTED",
  "EDIT_REQUESTED",
  // Re-added for scripts/import-expensedb-requests.ts — 36 legacy rows'
  // true historical status is EXPIRED (see migrations/014_reallow_expired_
  // status.sql). Purely a terminal, inert historical status now: nothing in
  // current app logic produces it (the old auto-expiry cron is gone), it
  // only exists so those imported rows have a real status to display.
  "EXPIRED",
] as const;
export type Status = (typeof STATUSES)[number];

export interface RequiredDocs {
  // "all": every listed doc type must be attached. "any": at least one of
  // the listed types satisfies the requirement.
  mode: "all" | "any";
  docs: string[];
}

export interface ExpenseTypeConfig {
  label: string;
  isUrgent?: boolean;
  hideBankFields?: boolean;
  hidePaymentSection?: boolean;
  hideDueDate?: boolean;
  showCreditTerm?: boolean;
  defaultRequiresPo: boolean;
  // Petty cash hides the PO Required section entirely (not just defaulting
  // requires_po to false) — see CLAUDE.md-style note in RequestForm.tsx.
  hidePoSection?: boolean;
  requiredDocs?: RequiredDocs;
}

// Exported so app/api/requests/route.ts (server-side validation),
// RequestForm.tsx, RequestDetailModal.tsx, and the print view can all
// reference the same exact label instead of drifting copies of the string.
export const PETTY_CASH_LABEL = "เบิกเงินสดย่อย (Petty cash)";
export const TRAVEL_EXPENSE_LABEL = "เบิกค่าเดินทาง";
export const ADVANCE_PAYMENT_LABEL = "เบิกเงินทดรองจ่าย (Advance Payment)";

// Expense types the printable request view (app/print/[id]) supports — see
// CLAUDE.md-style note on RequestDetailModal.tsx's Print button.
export const PRINTABLE_EXPENSE_TYPES: string[] = [PETTY_CASH_LABEL, ADVANCE_PAYMENT_LABEL, TRAVEL_EXPENSE_LABEL];

// Thai labels are exact strings from the legacy system — do not alter.
export const EXPENSE_TYPES: ExpenseTypeConfig[] = [
  {
    label: "เบิกค่าใช้จ่ายทั่วไปตามรอบบัญชี (Deposit-จ่ายก่อนรับของ)",
    defaultRequiresPo: true,
    requiredDocs: { mode: "all", docs: ["PO", "Invoice", "ใบกำกับภาษี (Tax Invoice)"] },
  },
  {
    label: "เบิกค่าใช้จ่ายทั่วไปตามรอบบัญชี (Credit-รับของก่อนจ่าย)",
    defaultRequiresPo: true,
    showCreditTerm: true,
    requiredDocs: {
      mode: "all",
      docs: [
        "PO",
        "Invoice",
        "ใบส่งของจาก Supplier",
        "ใบรับของจากระบบ AccCloud",
      ],
    },
  },
  {
    label: "เบิกค่าใช้จ่ายที่ชำระแล้ว (ตัดบัตรเครดิต, wallet, อื่นๆ)",
    defaultRequiresPo: false,
    hideDueDate: true,
    requiredDocs: { mode: "any", docs: ["Invoice", "ใบกำกับภาษี (Tax Invoice)"] },
  },
  {
    label: "เบิกเงินทดรองจ่าย (Advance Payment)",
    defaultRequiresPo: true,
    requiredDocs: { mode: "all", docs: ["ใบเสร็จ/สลิป", "ใบกำกับภาษี (Tax Invoice)"] },
  },
  {
    label: PETTY_CASH_LABEL,
    defaultRequiresPo: false,
    hidePoSection: true,
    // "ใบกำกับภาษี (if applicable)" per spec is deliberately not in the
    // required list below — it's conditional, and this checklist is
    // informational only (never a hard submit-blocking validation) anyway,
    // same as every other expense type's requiredDocs.
    requiredDocs: { mode: "all", docs: ["ใบเสร็จ/สลิป"] },
  },
  {
    label: "เบิกสินค้าสำหรับส่งเสริมการขาย (e.g. KOL/Influencer/แจกสินค้า)",
    hidePaymentSection: true,
    defaultRequiresPo: true,
  },
  {
    label: "เบิกสินค้าสำหรับใช้ภายใน (e.g. Product Tester/Display/Content/Shooting)",
    hidePaymentSection: true,
    defaultRequiresPo: false,
  },
  {
    label: "เบิกด่วน (Urgent Payment)",
    isUrgent: true,
    defaultRequiresPo: true,
  },
  {
    label: TRAVEL_EXPENSE_LABEL,
    // Not specified explicitly — inferred false since travel reimbursements
    // (mileage/public transport/taxi) are small ad-hoc claims, same
    // reasoning as Petty Cash's default. Unlike Petty Cash, the PO Required
    // section still shows (two selectable cards, submitter's final say) —
    // only Petty Cash was asked to hide it entirely.
    defaultRequiresPo: false,
  },
];

export function getExpenseTypeConfig(label: string): ExpenseTypeConfig | undefined {
  return EXPENSE_TYPES.find((t) => t.label === label);
}

// Payment Details section (lib/constants.ts) ------------------------------

export const PAYMENT_METHODS = [
  "โอนธนาคาร",
  "เงินสด",
  "บัตรเครดิต/เดบิต",
  "QR Payment",
  "หักจาก Wallet",
  "อื่นๆ",
] as const;

// Shared bank list — used by both the /submit Payment Details Bank Name
// picker and the Settings > Supplier Management modal, so the two stay in
// sync automatically.
export const BANK_OPTIONS = [
  "กสิกรไทย",
  "กรุงเทพ",
  "กรุงไทย",
  "ไทยพาณิชย์",
  "กรุงศรีอยุธยา",
  "ทหารไทยธนชาต",
  "ออมสิน",
  "UOB",
  "CIMB",
  "อื่นๆ",
] as const;

export const CARD_TYPES = ["Visa", "Mastercard", "AMEX", "JCB"] as const;

// Attachments section document types.
export const DOCUMENT_TYPES = [
  "PO",
  "Invoice",
  "ใบกำกับภาษี (Tax Invoice)",
  "ใบส่งของจาก Supplier",
  "ใบรับของจากระบบ AccCloud",
  "ใบเสร็จ/สลิป",
  "ภาพถ่ายเลขไมล์",
  "ระยะทางใน Google Maps",
  "ใบเสร็จรับเงิน หรือ สลิปเติมเงิน หรือ ประวัติการเดินทางจากแอป",
  "ใบเสร็จรับเงินอิเล็กทรอนิกส์ (E-Receipt)",
  "Other",
] as const;

// Per-item Travel by (เบิกค่าเดินทาง only) and its own required-docs
// checklist, added alongside the base expense-type checklist above (not
// instead of it) when at least one item in the request has a travel_by set.
export const TRAVEL_BY_OPTIONS = [
  "รถยนต์/จักรยานยนต์ส่วนตัว",
  "รถสาธารณะ (BTS/MRT/Bus)",
  "Grab/Taxi",
  "ค่าทางด่วน/ค่าที่จอด",
] as const;
export type TravelBy = (typeof TRAVEL_BY_OPTIONS)[number];

// THB per km for the personal-vehicle auto-calculated Net Amount.
export const TRAVEL_RATE_PER_KM = 8;

export const TRAVEL_REQUIRED_DOCS: Record<TravelBy, string[]> = {
  "รถยนต์/จักรยานยนต์ส่วนตัว": ["ภาพถ่ายเลขไมล์", "ระยะทางใน Google Maps"],
  "รถสาธารณะ (BTS/MRT/Bus)": ["ใบเสร็จรับเงิน หรือ สลิปเติมเงิน หรือ ประวัติการเดินทางจากแอป"],
  "Grab/Taxi": ["ใบเสร็จรับเงินอิเล็กทรอนิกส์ (E-Receipt)"],
  "ค่าทางด่วน/ค่าที่จอด": ["ใบเสร็จรับเงิน"],
};

// Homepage calendar (see CLAUDE.md "Homepage Calendar") — not a DB CHECK
// constraint on calendar_events.event_type, validated against this list
// client- and server-side instead. Roles allowed to create/delete events —
// same set the spec named for both actions, kept as one constant rather
// than two identical arrays.
export const CALENDAR_EVENT_TYPES: { value: CalendarEventType; label: string }[] = [
  { value: "payment", label: "Payment" },
  { value: "deadline", label: "Deadline" },
  { value: "reminder", label: "Reminder" },
  { value: "important", label: "Important" },
  { value: "general", label: "General" },
];
export const CALENDAR_MANAGE_ROLES: Role[] = ["SUPERADMIN", "ACCOUNTING", "CEO", "PROCUREMENT"];

// Departments without a dedicated Discord channel fall back to
// DISCORD_WEBHOOK_DEFAULT (Factory Investment, People & HR & System,
// Merchandise, COG have no channel listed in the business requirements).
// Keys are the EXACT strings live in categories.department (verified via a
// direct REST query against the production table, 2026-07-14) — these are
// what actually lands in requests.department at submission time, since
// /submit's department picker is sourced dynamically from /api/departments
// (itself derived from categories.department), not from the DEPARTMENTS
// constant above. The previous version of this map used DEPARTMENTS'
// clean/unabbreviated strings, which no longer matched live data at all
// except for "R&D", "Retail", and "OEM" — every other department silently
// fell back to DISCORD_WEBHOOK_DEFAULT (or nothing, if that wasn't set).
//
// One correction from the literal fix spec: "Factory Investment (FACINV)"
// was requested, but the live table actually stores the bare
// "Factory Investment" (no "(FACINV)" suffix) — used the real value here
// instead, since keeping the spec's typo'd string would leave this
// department exactly as broken as before.
export const DEPARTMENT_WEBHOOK_ENV: Record<string, string> = {
  Factory: "DISCORD_WEBHOOK_FACTORY",
  "Factory Investment": "DISCORD_WEBHOOK_FACINV",
  "Factory Investment (FACINV)": "DISCORD_WEBHOOK_FACINV",
  COGs: "DISCORD_WEBHOOK_FACTORY",
  "R&D": "DISCORD_WEBHOOK_RD",
  "Lab Instrument Investment (RD)": "DISCORD_WEBHOOK_LABINV",
  "Marketing (MKT)": "DISCORD_WEBHOOK_MARKETING",
  Merchandise: "DISCORD_WEBHOOK_MARKETING",
  "General Administrative (GA)": "DISCORD_WEBHOOK_GA",
  "People (HR)": "DISCORD_WEBHOOK_GA",
  Retail: "DISCORD_WEBHOOK_RETAIL",
  "New Store Investment": "DISCORD_WEBHOOK_STOREINV",
  "Fulfillment operation": "DISCORD_WEBHOOK_WH",
  OEM: "DISCORD_WEBHOOK_FACTORY",
};

export const CEO_WEBHOOK_ENV = "DISCORD_WEBHOOK_CEO";
export const DEFAULT_WEBHOOK_ENV = "DISCORD_WEBHOOK_DEFAULT";
// Second-tier fallback for departmentWebhookUrl(): if a department has no
// map entry (or its mapped var isn't set) AND DISCORD_WEBHOOK_DEFAULT also
// isn't set, fall back to the GA channel rather than sending nothing.
export const GA_WEBHOOK_ENV = "DISCORD_WEBHOOK_GA";
