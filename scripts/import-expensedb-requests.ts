// One-time import of the legacy Google Sheets "ExpenseDB - Requests" export
// into the live `requests` table. Distinct from scripts/migrate-from-sheets.ts,
// which only *normalizes* rows already sitting in Supabase — this script is
// the thing that actually puts the historical rows there in the first
// place. Plain Node script (`npx tsx scripts/import-expensedb-requests.ts`
// or `npm run import:expensedb`), not part of the Next.js app itself.
//
// **Dry-run by default** (parses, maps, and reports — writes nothing);
// `--apply` actually inserts. Always run the dry run first and read the
// report in full, in particular:
//   - "unmatched department/category values" — anything not in the maps
//     below is imported with its original legacy name untouched, which will
//     silently fail every exact-string match against lib/constants.ts
//     DEPARTMENTS / dept_config / BO dept_scope. Add it to the relevant map
//     and re-run if it should be renamed.
//   - "rows already in the live table" — this script is safe to re-run;
//     already-imported request_ids are skipped, never overwritten (this is
//     a one-time import, not an ongoing sync — unlike migrate-from-sheets.ts
//     it does not diff/update existing rows).
//   - "REJECTED rows with no recoverable rejected_by/rejected_at" — the
//     legacy sheet has no rejected_by column at all; this script recovers it
//     from the last entry of that row's rejection_history JSON where
//     possible, but a meaningful share of legacy rejections were logged as
//     literally "(unknown)"/"(date not recorded)" at the source and stay
//     null here. Not a bug in this script — a gap in the legacy data.
//
// Requires supabase/migrations/014_reallow_expired_status.sql to already be
// applied (36 legacy rows have status EXPIRED, which the live CHECK
// constraint disallowed before that migration — see its header comment for
// why re-allowing it, rather than remapping those rows to REJECTED or
// dropping them, was the chosen approach).
//
// Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
// .env.local, same hand-rolled loader as migrate-from-sheets.ts (a
// standalone script isn't covered by Next's own env loading).
//
// The CSV itself is never committed (*.csv is gitignored) — point --file at
// wherever you saved "ExpenseDB - Requests.csv"; defaults to that filename
// in the repo root.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const CSV_PATH = resolve(process.cwd(), fileArg ? fileArg.slice("--file=".length) : "ExpenseDB - Requests.csv");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — checked process.env and .env.local.",
  );
  process.exit(1);
}

if (!existsSync(CSV_PATH)) {
  console.error(`CSV not found at ${CSV_PATH}. Pass --file=/path/to/"ExpenseDB - Requests.csv".`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- Minimal RFC4180 CSV parser (no dependency — this repo has none) -------
// Handles quoted fields, embedded commas, embedded newlines, and "" as an
// escaped quote. Google Sheets' CSV export follows this exactly.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // last field/row (file may or may not end with a trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      rec[h] = r[idx] ?? "";
    });
    return rec;
  });
}

// --- Department / category normalization ------------------------------------
// Source (legacy) values on the left are the same set scripts/migrate-from-
// sheets.ts already identified from this same data. Targets on the right are
// fixed to the actual canonical, UNSUFFIXED lib/constants.ts#DEPARTMENTS
// values — migrate-from-sheets.ts's own map targets things like "General
// Administrative (GA)" with a "(ABBREV)" suffix that's display-only
// (lib/constants.ts#DEPARTMENT_ABBREV) and never the real stored value; that
// mismatch is flagged as unresolved there and deliberately NOT reused here.

const DEPARTMENT_NAME_MAP: Record<string, string> = {
  "General & Administrative (Backoffice)": "General Administrative",
  "General Administrative (Backoffice)": "General Administrative",
  "General Administrative": "General Administrative",
  "G&A": "General Administrative",
  Backoffice: "General Administrative",
  "Operation & Fulfillment": "Operations/Fulfillment",
  "Operations & Fulfillment": "Operations/Fulfillment",
  "Operations/Fulfillment": "Operations/Fulfillment",
  "OPS & FF": "Operations/Fulfillment",
  "Depreciation & CAPEX (Factory Investment)": "Factory Investment",
  "Factory Investment": "Factory Investment",
  FACINV: "Factory Investment",
  "New Store Investment": "Store Investment",
  "Store Investment": "Store Investment",
  STOREINV: "Store Investment",
  "Lab Instrument Investment (RD)": "Lab Instrument Investment",
  "Lab Instrument Investment": "Lab Instrument Investment",
  "Lab Instrument": "Lab Instrument Investment",
  Marketing: "Marketing",
  MKT: "Marketing",
  "Marketing & Sales": "Marketing",
  "People & HR": "People & HR & System",
  "People & HR & System": "People & HR & System",
  HR: "People & HR & System",
  COG: "COG",
  COGS: "COG",
  Factory: "Factory",
  "R&D": "R&D",
  Retail: "Retail",
  Merchandise: "Merchandise",
  OEM: "OEM",
};

function normalizeDepartment(dept: string, unmatched: Set<string>): string {
  const trimmed = dept.trim();
  if (!trimmed) return trimmed;
  if (trimmed in DEPARTMENT_NAME_MAP) return DEPARTMENT_NAME_MAP[trimmed];
  unmatched.add(trimmed);
  return trimmed;
}

// Same map as scripts/migrate-from-sheets.ts — no suffix issue was flagged
// for this one, so reused as-is (kept as a literal copy, not imported,
// since this script is intentionally self-contained like that one).
const CATEGORY_NAME_MAP: Record<string, string> = {
  "Factory Consumable": "Factory Consumable",
  "Raw Material": "Raw Materials",
  "Raw Materials": "Raw Materials",
  "NPD Raw Material": "NPD-Raw Material",
  "NPD-Raw Material": "NPD-Raw Material",
  "NPD Packaging": "NPD-Packaging",
  "NPD-Packaging": "NPD-Packaging",
  Logistics: "Logistics & Shipping",
  "Logistics & Shipping": "Logistics & Shipping",
  Warehouse: "Warehouse & Inventory",
  "Warehouse & Inventory": "Warehouse & Inventory",
  "Finance & Accounting": "Finance & Accounting",
  Legal: "Legal & Compliance",
  "Legal & Compliance": "Legal & Compliance",
  Software: "Software & Tools",
  "Software & Tools": "Software & Tools",
  Benefits: "Talent Benefits & Perks",
  "Talent Benefits & Perks": "Talent Benefits & Perks",
  "Employee Benefits": "EMPLOYEE BENEFITS & WELFARE (Company-Wide)",
  "EMPLOYEE BENEFITS & WELFARE (Company-Wide)": "EMPLOYEE BENEFITS & WELFARE (Company-Wide)",

  // Clear spelling/abbreviation variants of an already-live category value
  // (identified from the dry-run's "unmatched category" report — see the
  // conversation this script's history came from).
  "Process Development": "Process Dev",
  "Product Development": "Product Dev",
  "Software & Tools:": "Software & Tools",

  // cat_l1-only fixes from Darling's ground-truth mapping file
  // ("ExpenseDB - Request mapping.csv", columns old/map_to_segment/
  // map_to_catl1/map_to_catl2). Scope for this batch is cat_l1 only —
  // map_to_segment and map_to_catl2 are deliberately NOT applied here;
  // department/segment and cat_l2 are left exactly as the original CSV
  // recorded them for every row. Keys are the exact legacy cat_l1 string
  // as it appears in the source ExpenseDB CSV (not the mapping file's own
  // spelling, which differed by whitespace in one case — see
  // "Renewal  (Existing Product)" below, double space, matching the
  // source's typo rather than the mapping file's cleaned-up single space).
  // "Goods / Merchandise" maps to "NPD" per Darling's correction after the
  // file was made (the blank map_to_catl1 cell in the file is stale).
  "Offline Store MKT": "Brand Building",
  "Packaging (Product)": "Direct Material - COG",
  "Other Expense": "In-Store Consumables & Supplies",
  "Staff Travel": "Retail ค่าเดินทาง",
  "Recruitment": "HR Operation",
  "MKT Other expenses": "Supporting Budget",
  "Sponsor": "Brand Building",
  "Factory Operation": "Factory Operation (OH) - COG",
  "Office & Facilities": "HR Operation",
  "ทะเบียนวัตถุอันตรายทางการเกษตร": "Legal & Compliance",
  "Renewal  (Existing Product)": "Regulatory Compliance",
  "Goods / Merchandise": "NPD",
  "Packaging (COG)": "Direct Material - COG",
  "Raw Materials (COG)": "Direct Material - COG",
  "Warehouse  Operation": "Warehouse",
  "New Product": "NPD",
  "Subtotal Retail Salaries&Benefit": "HR Salary",
  "Quality Control": "Factory Operation (OH) - COG",
  "Packaging": "Direct Material - COG",
  "Inventory Management Software": "Software & Tools",
  "Event (Offline Campaign)": "Brand Building",
  "Collab with other brands": "Brand Building",
  "KA Training": "HRD",
  "OPFF-Other expense": "Fulfillment operation consumables",
};

function normalizeCategory(cat: string, unmatched: Set<string>): string {
  const trimmed = cat.trim();
  if (!trimmed) return trimmed;
  if (trimmed in CATEGORY_NAME_MAP) return CATEGORY_NAME_MAP[trimmed];
  unmatched.add(trimmed);
  return trimmed;
}

// --- Known test/junk rows -------------------------------------------------
// Confirmed test/junk data, not real historical expenses: all on the
// admin@coroand.co account, named/described as tests, never PAID (EXPIRED
// or REJECTED only). Excluded outright rather than imported-and-flagged,
// since there's no real expense here to preserve.
const EXCLUDED_REQUEST_IDS = new Set<string>([
  "EXP-2026-02-000109", // "Test reject editable", EXPIRED
  "EXP-2026-04-000096", // "Test", EXPIRED
  "EXP-2026-04-000101", // "Procurement & Exp new version testing", EXPIRED
  "EXP-2026-04-000102", // "test discord noti", REJECTED
]);

// --- Email domain swap (same as migrate-from-sheets.ts / CLAUDE.md) --------

const OLD_DOMAIN = `@${process.env.OLD_EMAIL_DOMAIN ?? "coroand.co"}`;
const NEW_DOMAIN = `@${process.env.NEW_EMAIL_DOMAIN ?? "mimetta.co"}`;

function swapDomain(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().endsWith(OLD_DOMAIN) ? trimmed.slice(0, -OLD_DOMAIN.length) + NEW_DOMAIN : trimmed;
}

// --- Parsing helpers ---------------------------------------------------

function s(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// The legacy sheet formats larger numbers with comma thousands-separators
// (e.g. "4,500.00", "32,000.00"). Number()/parseInt() don't understand
// those: Number("4,500.00") is NaN (silently falling back to 0 below —
// this is exactly the bug that zeroed out amount_net/total/vat_amount/
// wht_amount on ~410 of 825 rows in the first import run), and
// parseInt("4,500", 10) stops at the first comma and returns 4. Every
// numeric field needs commas stripped before parsing, not just the ones
// that happened to be large enough to need this in practice so far.
function stripThousandsSeparators(v: string): string {
  return v.replace(/,/g, "");
}

function num(v: string | undefined, fallback = 0): number {
  const t = (v ?? "").trim();
  if (t === "") return fallback;
  const n = Number(stripThousandsSeparators(t));
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined): boolean | null {
  const t = (v ?? "").trim().toUpperCase();
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  return null;
}

// credit_term_days/resubmit_count realistically never reach four digits,
// so this was never observed to misfire in practice — fixed anyway for
// consistency with num() above, on the same underlying data (a legacy
// export that formats every number this way, not just the ones that
// happened to be large enough to trigger a visible bug).
function intOrNull(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = parseInt(stripThousandsSeparators(t), 10);
  return Number.isFinite(n) ? n : null;
}

// Legacy dates are "M/D/YYYY H:MM:SS" or "M/D/YYYY" (Google Sheets' default
// US-locale CSV export format). due_date sometimes already arrives as
// "YYYY-MM-DD" (ISO) — passed through untouched when it matches that shape.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATETIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/;

let implausibleDateWarnings = 0;

function parseUsDate(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  if (ISO_DATE.test(t)) return t;
  const m = US_DATETIME.exec(t);
  if (!m) return null;
  const [, mo, day, yr, hh, mi, ss] = m;
  const month = parseInt(mo, 10);
  const d = parseInt(day, 10);
  if (month > 12) implausibleDateWarnings++; // would indicate D/M, not M/D
  const iso = `${yr}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}` +
    (hh ? `T${hh.padStart(2, "0")}:${mi}:${ss}` : "T00:00:00");
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function budgetPeriodFromTimestamp(iso: string | null): string {
  if (!iso) return "unknown";
  return iso.slice(0, 7); // YYYY-MM
}

// --- Row mapping ---------------------------------------------------------

interface RejectionEntryLegacy {
  round?: number;
  rejected_by?: string;
  stage?: string;
  reason?: string;
  rejected_at?: string;
  resubmitted_at?: string | null;
}

function safeJsonArray<T>(v: string | undefined): T[] {
  const t = (v ?? "").trim();
  if (t === "") return [];
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface MappedRow {
  request_id: string;
  data: Record<string, unknown>;
  yearMonth: string;
  seq: number;
}

interface ImportReport {
  totalCsvRows: number;
  duplicateRequestIdsInCsv: string[];
  missingRequestId: number;
  invalidBu: { request_id: string; bu: string }[];
  excludedTestRows: string[];
  statusBreakdown: Record<string, number>;
  budgetPeriodBackfilled: number;
  unmatchedDept: Set<string>;
  unmatchedCat: Set<string>;
  rejectedMissingActor: number;
  rejectedMissingDate: number;
}

function mapRow(
  row: Record<string, string>,
  report: ImportReport,
): MappedRow | null {
  const request_id = s(row.request_id);
  if (!request_id) {
    report.missingRequestId++;
    return null;
  }

  if (EXCLUDED_REQUEST_IDS.has(request_id)) {
    report.excludedTestRows.push(request_id);
    return null;
  }

  const ymMatch = /^EXP-(\d{4}-\d{2})-(\d{6})$/.exec(request_id);
  const yearMonth = ymMatch?.[1] ?? "unknown";
  const seq = ymMatch ? parseInt(ymMatch[2], 10) : 0;

  const timestampIso = parseUsDate(row.timestamp) ?? new Date().toISOString();

  const buRaw = (row.bu ?? "").trim().toUpperCase();
  if (buRaw !== "SV" && buRaw !== "ONEST") {
    report.invalidBu.push({ request_id, bu: row.bu });
    return null;
  }

  let budget_period = s(row.budget_period);
  if (!budget_period) {
    budget_period = budgetPeriodFromTimestamp(timestampIso);
    report.budgetPeriodBackfilled++;
  }

  const department = row.department ? normalizeDepartment(row.department, report.unmatchedDept) : "";
  const cat_l1 = row.cat_l1 ? normalizeCategory(row.cat_l1, report.unmatchedCat) : null;

  const status = (row.status ?? "").trim() || "SUBMITTED";
  report.statusBreakdown[status] = (report.statusBreakdown[status] ?? 0) + 1;

  // rejection_history: legacy shape { round, rejected_by, stage, reason,
  // rejected_at, resubmitted_at } -> current RejectionHistoryEntry shape
  // { stage, actor_email, reason, rejected_at }. "(unknown)" / "(date not
  // recorded)" sentinels from the legacy sheet are preserved as-is (not
  // silently turned into real-looking data) rather than guessed at.
  const legacyHistory = safeJsonArray<RejectionEntryLegacy>(row.rejection_history);
  const rejection_history = legacyHistory.map((e) => ({
    stage: e.stage ?? "(unknown)",
    actor_email: e.rejected_by && e.rejected_by !== "(unknown)" ? swapDomain(e.rejected_by) : e.rejected_by ?? "(unknown)",
    reason: e.reason ?? "",
    rejected_at: e.rejected_at ?? "(date not recorded)",
  }));

  // requests.rejected_by has no legacy CSV column at all — recover it from
  // the last rejection_history entry when possible.
  const lastRejection = legacyHistory[legacyHistory.length - 1];
  let rejected_by: string | null = null;
  let rejected_at = parseUsDate(row.rejected_at);
  let rejected_stage = s(row.rejected_stage);
  if (status === "REJECTED") {
    if (lastRejection?.rejected_by && lastRejection.rejected_by !== "(unknown)") {
      rejected_by = swapDomain(lastRejection.rejected_by);
    } else {
      report.rejectedMissingActor++;
    }
    if (!rejected_at && lastRejection?.rejected_at && lastRejection.rejected_at !== "(date not recorded)") {
      rejected_at = parseUsDate(lastRejection.rejected_at);
    }
    if (!rejected_at) report.rejectedMissingDate++;
    if (!rejected_stage && lastRejection?.stage && lastRejection.stage !== "(unknown)") {
      rejected_stage = lastRejection.stage;
    }
  }

  // files_json + po_files_json (legacy keeps PO attachments in a separate
  // column; current schema has one files_json array) — merged, PO-sourced
  // entries tagged so they're at least distinguishable, even though they
  // won't automatically satisfy the /submit required-docs checklist (that
  // checklist keys off doc_type strings this legacy data never set either).
  const files = safeJsonArray<Record<string, unknown>>(row.files_json);
  const poFiles = safeJsonArray<Record<string, unknown>>(row.po_files_json).map((f) => ({
    ...f,
    doc_type: f.doc_type ?? "PO / Purchase Order (legacy)",
  }));
  const files_json = [...files, ...poFiles];

  const description = s(row.description) ?? "";
  const amount_net = num(row.amount_net);
  const vat_rate = num(row.vat_rate);
  const wht_rate = num(row.wht_rate);

  const items_json = [
    {
      description,
      amount_net,
      vat_rate,
      wht_rate,
      cat_l1: cat_l1 ?? undefined,
      cat_l2: s(row.cat_l2) ?? undefined,
      segment: department || undefined,
      product: s(row.product) ?? undefined,
      product_code: s(row.product_code),
    },
  ];

  const data: Record<string, unknown> = {
    request_id,
    timestamp: timestampIso,
    requester_email: swapDomain(row.requester_email ?? ""),
    requester_name: s(row.requester_name) ?? "",
    bu: buRaw,
    expense_type: s(row.expense_type) ?? "",
    urgent_reason: s(row.urgent_reason),
    department,
    budget_period,
    product: s(row.product),
    cat_l1,
    cat_l2: s(row.cat_l2),
    description,
    amount_net,
    vat_rate,
    vat_amount: num(row.vat_amount),
    wht_rate,
    wht_amount: num(row.wht_amount),
    total: num(row.total, amount_net),
    supplier_name: s(row.supplier_name),
    pay_method: s(row.pay_method),
    bank_name: s(row.bank_name),
    card_type: s(row.card_type),
    pay_ref: s(row.pay_ref),
    credit_term_days: intOrNull(row.credit_term_days),
    due_date: parseUsDate(row.due_date),
    status,
    files_folder_url: s(row.files_folder_url),
    files_json,
    requires_po: bool(row.requires_po) ?? true,
    po_number: s(row.po_number),
    po_date: s(row.po_date),
    po_vendor: s(row.po_vendor),
    po_delivery_date: s(row.po_delivery_date),
    po_notes: s(row.po_notes),
    po_uploaded_by: row.po_uploaded_by ? swapDomain(row.po_uploaded_by) : null,
    po_uploaded_at: parseUsDate(row.po_uploaded_at),
    bo_approver: row.bo_approver ? swapDomain(row.bo_approver) : null,
    bo_approved_at: parseUsDate(row.bo_approved_at),
    ceo_approver: row.ceo_approver ? swapDomain(row.ceo_approver) : null,
    ceo_approved_at: parseUsDate(row.ceo_approved_at),
    ceo_signature_required: bool(row.ceo_signature_required),
    accounting_user: row.accounting_user ? swapDomain(row.accounting_user) : null,
    paid_at: parseUsDate(row.paid_at),
    rejected_by,
    rejected_stage,
    reject_reason: s(row.reject_reason),
    rejected_at,
    rejection_history,
    resubmit_count: intOrNull(row.resubmit_count) ?? 0,
    last_resubmitted_at: parseUsDate(row.last_resubmitted_at),
    items_json,
    items_summary: description,
    items_count: 1,
    product_code: s(row.product_code),
    skip_bo: false,
    skip_ceo: false,
    // Not part of the legacy sheet at all — left at their column defaults /
    // null, same as every other post-launch feature column (chapter,
    // use_for_company, petty_cash_holder_email, procurement_fills_payment,
    // travel_items, edit_* / status_before_edit).
  };

  return { request_id, data, yearMonth, seq };
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Running in APPLY mode — rows will be inserted."
      : "Running in DRY-RUN mode (default) — no rows will be written. Pass --apply to write.",
  );
  console.log(`Supabase project: ${SUPABASE_URL}`);
  console.log(`CSV file: ${CSV_PATH}`);
  console.log("");

  const csvText = readFileSync(CSV_PATH, "utf8");
  const records = csvToRecords(csvText);

  const report: ImportReport = {
    totalCsvRows: records.length,
    duplicateRequestIdsInCsv: [],
    missingRequestId: 0,
    invalidBu: [],
    excludedTestRows: [],
    statusBreakdown: {},
    budgetPeriodBackfilled: 0,
    unmatchedDept: new Set(),
    unmatchedCat: new Set(),
    rejectedMissingActor: 0,
    rejectedMissingDate: 0,
  };

  const seenIds = new Set<string>();
  const mapped: MappedRow[] = [];
  for (const row of records) {
    const m = mapRow(row, report);
    if (!m) continue;
    if (seenIds.has(m.request_id)) {
      report.duplicateRequestIdsInCsv.push(m.request_id);
      continue; // first occurrence wins
    }
    seenIds.add(m.request_id);
    mapped.push(m);
  }

  // Idempotency: skip request_ids already present in the live table.
  // Supabase .in() is queried in chunks to stay well under URL/body limits.
  const existingIds = new Set<string>();
  const idList = mapped.map((m) => m.request_id);
  for (let i = 0; i < idList.length; i += 500) {
    const chunk = idList.slice(i, i + 500);
    const { data, error } = await admin.from("requests").select("request_id").in("request_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((r: { request_id: string }) => existingIds.add(r.request_id));
  }

  const toInsert = mapped.filter((m) => !existingIds.has(m.request_id));

  console.log("=== Import report ===");
  console.log(`CSV rows parsed: ${report.totalCsvRows}`);
  console.log(`Rows missing request_id (skipped): ${report.missingRequestId}`);
  console.log(`Duplicate request_ids within the CSV (first occurrence kept): ${report.duplicateRequestIdsInCsv.length}`);
  if (report.duplicateRequestIdsInCsv.length > 0) {
    report.duplicateRequestIdsInCsv.forEach((id) => console.log(`  - ${id}`));
  }
  console.log(`Rows with invalid bu (not SV/ONEST, skipped): ${report.invalidBu.length}`);
  if (report.invalidBu.length > 0) {
    report.invalidBu.forEach((r) => console.log(`  - ${r.request_id}: "${r.bu}"`));
  }
  console.log(`Excluded known test/junk rows (EXCLUDED_REQUEST_IDS): ${report.excludedTestRows.length}`);
  if (report.excludedTestRows.length > 0) {
    report.excludedTestRows.forEach((id) => console.log(`  - ${id}`));
  }
  console.log(`Already present in the live table (skipped): ${existingIds.size}`);
  console.log(`Would ${APPLY ? "insert" : "be inserted"}: ${toInsert.length}`);
  console.log("");
  console.log("Status breakdown (all mapped rows, including already-imported):");
  Object.entries(report.statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([st, count]) => console.log(`  ${st}: ${count}`));
  console.log("");
  console.log(`budget_period backfilled from timestamp (was blank): ${report.budgetPeriodBackfilled}`);
  console.log(`REJECTED rows with no recoverable rejected_by: ${report.rejectedMissingActor}`);
  console.log(`REJECTED rows with no recoverable rejected_at: ${report.rejectedMissingDate}`);
  if (implausibleDateWarnings > 0) {
    console.log(
      `⚠️  ${implausibleDateWarnings} date value(s) had a month component > 12 — this data may actually be ` +
        `D/M/YYYY, not M/D/YYYY as assumed. Investigate before trusting any parsed date/timestamp column.`,
    );
  }
  console.log("");
  if (report.unmatchedDept.size > 0) {
    console.log(`Unmatched department values (${report.unmatchedDept.size}) — not in DEPARTMENT_NAME_MAP, imported as-is:`);
    Array.from(report.unmatchedDept).forEach((d) => console.log(`  - ${JSON.stringify(d)}`));
  } else {
    console.log("No unmatched department values.");
  }
  if (report.unmatchedCat.size > 0) {
    console.log(`Unmatched category values (${report.unmatchedCat.size}) — not in CATEGORY_NAME_MAP, imported as-is:`);
    Array.from(report.unmatchedCat).forEach((c) => console.log(`  - ${JSON.stringify(c)}`));
  } else {
    console.log("No unmatched category values.");
  }
  console.log("");

  // request_id_seq: explicit request_id inserts bypass generate_request_id()
  // entirely, so request_id_seq never learns about these months. Without
  // advancing it, the next *real* submission in an imported month would
  // start back at seq 1 and collide with an imported row's primary key.
  const maxSeqByMonth = new Map<string, number>();
  for (const m of mapped) {
    if (m.yearMonth === "unknown") continue;
    maxSeqByMonth.set(m.yearMonth, Math.max(maxSeqByMonth.get(m.yearMonth) ?? 0, m.seq));
  }
  console.log(`request_id_seq will be advanced for ${maxSeqByMonth.size} year_month(s) to stay ahead of imported IDs:`);
  Array.from(maxSeqByMonth.entries())
    .sort()
    .forEach(([ym, max]) => console.log(`  ${ym}: last_seq -> at least ${max}`));
  console.log("");

  if (!APPLY) {
    console.log("Dry run complete — no changes written. Re-run with --apply to import.");
    return;
  }

  // Insert in batches; on a batch failure, retry row-by-row so one bad row
  // doesn't silently drop the rest of a batch, and so failures are reported
  // by request_id rather than aborting the whole import.
  const BATCH = 100;
  let inserted = 0;
  const failures: { request_id: string; error: string }[] = [];
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await admin.from("requests").insert(batch.map((b) => b.data));
    if (!error) {
      inserted += batch.length;
      continue;
    }
    for (const row of batch) {
      const { error: rowError } = await admin.from("requests").insert(row.data);
      if (rowError) {
        failures.push({ request_id: row.request_id, error: rowError.message });
      } else {
        inserted++;
      }
    }
  }
  console.log(`Inserted ${inserted} of ${toInsert.length} row(s).`);
  if (failures.length > 0) {
    console.log(`Failed (${failures.length}):`);
    failures.forEach((f) => console.log(`  - ${f.request_id}: ${f.error}`));
  }

  // Advance request_id_seq past every imported month's max sequence.
  for (const [ym, maxSeq] of maxSeqByMonth) {
    const { data: existing, error: selError } = await admin
      .from("request_id_seq")
      .select("last_seq")
      .eq("year_month", ym)
      .maybeSingle();
    if (selError) throw selError;
    const target = Math.max(existing?.last_seq ?? 0, maxSeq);
    const { error: upsertError } = await admin
      .from("request_id_seq")
      .upsert({ year_month: ym, last_seq: target }, { onConflict: "year_month" });
    if (upsertError) throw upsertError;
  }
  console.log(`request_id_seq advanced for ${maxSeqByMonth.size} year_month(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
