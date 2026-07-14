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
  "EMPLOYEE",
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
  requiredDocs?: RequiredDocs;
}

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
  },
  {
    label: "เบิกเงินสดย่อย (Petty cash)",
    defaultRequiresPo: false,
  },
  {
    label: "เบิกสำหรับส่งเสริมการขาย (e.g. KOL/Influencer, แจกสินค้า)",
    hideBankFields: true,
    defaultRequiresPo: true,
  },
  {
    label: "เบิกสำหรับ Product Tester/Display (เบิกใช้ภายใน คิดงบจากต้นทุนสินค้า)",
    hidePaymentSection: true,
    defaultRequiresPo: false,
  },
  {
    label: "เบิกด่วน (Urgent Payment)",
    isUrgent: true,
    defaultRequiresPo: true,
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
  "Other",
] as const;

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
