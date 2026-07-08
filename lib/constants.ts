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

// Departments without a dedicated Discord channel fall back to
// DISCORD_WEBHOOK_DEFAULT (Factory Investment, People & HR & System,
// Merchandise, COG have no channel listed in the business requirements).
export const DEPARTMENT_WEBHOOK_ENV: Record<string, string> = {
  Factory: "DISCORD_WEBHOOK_FACTORY",
  Marketing: "DISCORD_WEBHOOK_MARKETING",
  "R&D": "DISCORD_WEBHOOK_RD",
  "Lab Instrument Investment": "DISCORD_WEBHOOK_RD",
  "Store Investment": "DISCORD_WEBHOOK_STOREINV",
  "Operations/Fulfillment": "DISCORD_WEBHOOK_OPF",
  Retail: "DISCORD_WEBHOOK_RETAIL",
  "General Administrative": "DISCORD_WEBHOOK_GA",
  OEM: "DISCORD_WEBHOOK_OEM",
};

export const CEO_WEBHOOK_ENV = "DISCORD_WEBHOOK_CEO";
export const DEFAULT_WEBHOOK_ENV = "DISCORD_WEBHOOK_DEFAULT";
