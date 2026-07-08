// One-time normalization pass over live data: reconciles department/category
// names that differ between the old Google Apps Script system's naming and
// this app's canonical names (see DEPARTMENT_NAME_MAP / CATEGORY_NAME_MAP
// below), and (re-)applies the @coroand.co -> @mimetta.co email domain swap
// documented in CLAUDE.md ("Email Domain Migration") to every email column.
//
// Plain Node script — not part of the Next.js app, not imported by
// anything under app/. Run manually:
//
//   npx tsx scripts/migrate-from-sheets.ts            # dry run (default): reports only, writes nothing
//   npx tsx scripts/migrate-from-sheets.ts --apply     # writes the normalized values
//
// Always run the dry run first and read the report — in particular the
// "unmatched" lists at the end, which call out any department/category
// value neither map recognizes (left untouched either way; add it to the
// relevant map above and re-run if it should be renamed).
//
// Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
// .env.local (same file the Next.js app itself uses) since a standalone
// script isn't covered by Next's own env loading.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // fine if it doesn't exist — real env vars may already be set
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — checked process.env and .env.local.",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- Department name normalization ------------------------------------------
// Old GAS name -> new system name, exactly as specified for this script.
//
// ⚠️ CONFIRMED MISMATCH, left as originally specified rather than silently
// "corrected": several target values below (e.g. "General Administrative
// (GA)", "Operations/Fulfillment (OPF)", "Factory Investment (FACINV)",
// "Store Investment (STOREINV)") include a "(ABBREV)" suffix — but that
// suffix is a UI-only display label (see lib/constants.ts#DEPARTMENT_ABBREV,
// appended client-side in dropdowns), never part of the actual stored
// `department` value, which is always the plain form (see
// lib/constants.ts#DEPARTMENTS). A dry run against live data confirms 60
// `categories` rows and 2 `requests` rows already correctly hold the plain
// form and would be renamed to the suffixed form by --apply, which would
// then silently fail to match lib/constants.ts#DEPARTMENTS,
// dept_config.dept, and BO dept_scope comparisons for every one of them
// (all exact-string-equality checks — see CLAUDE.md "DeptConfig Matching"
// and "BO Scope Filtering"). Fix the target values below (drop the "(...)"
// suffixes) before ever running with --apply, unless the suffixed form is
// genuinely intended and DEPARTMENTS/DEPARTMENT_ABBREV/dept_config get
// updated to match it everywhere.

const DEPARTMENT_NAME_MAP: Record<string, string> = {
  "General & Administrative (Backoffice)": "General Administrative (GA)",
  "General Administrative (Backoffice)": "General Administrative (GA)",
  "G&A": "General Administrative (GA)",
  Backoffice: "General Administrative (GA)",
  "Operation & Fulfillment": "Operations/Fulfillment (OPF)",
  "Operations & Fulfillment": "Operations/Fulfillment (OPF)",
  "OPS & FF": "Operations/Fulfillment (OPF)",
  "Depreciation & CAPEX (Factory Investment)": "Factory Investment (FACINV)",
  "Factory Investment": "Factory Investment (FACINV)",
  FACINV: "Factory Investment (FACINV)",
  "New Store Investment": "Store Investment (STOREINV)",
  "Store Investment": "Store Investment (STOREINV)",
  STOREINV: "Store Investment (STOREINV)",
  "Lab Instrument Investment (RD)": "Lab Instrument Investment (RD)",
  "Lab Instrument": "Lab Instrument Investment (RD)",
  Marketing: "Marketing (MKT)",
  MKT: "Marketing (MKT)",
  "Marketing & Sales": "Marketing (MKT)",
  "People & HR": "People & HR & System",
  HR: "People & HR & System",
  COG: "COG",
  COGS: "COG",
  Factory: "Factory",
  "R&D": "R&D",
  Retail: "Retail",
  Merchandise: "Merchandise",
  OEM: "OEM",
};

function normalizeDepartment(dept: string | null, unmatched: Set<string>): string | null {
  if (!dept) return dept;
  const trimmed = dept.trim();
  if (trimmed in DEPARTMENT_NAME_MAP) return DEPARTMENT_NAME_MAP[trimmed];
  unmatched.add(trimmed);
  return trimmed;
}

// --- Category name normalization ------------------------------------------

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
};

function normalizeCategory(cat: string | null, unmatched: Set<string>): string | null {
  if (!cat) return cat;
  const trimmed = cat.trim();
  if (trimmed in CATEGORY_NAME_MAP) return CATEGORY_NAME_MAP[trimmed];
  unmatched.add(trimmed);
  return trimmed;
}

// Comma-separated scope lists (roles.dept_scope / cat_l1_scope) — '*' passes
// through untouched (wildcard, not a real name); every other entry is
// normalized individually and rejoined.
function normalizeScopeList(
  scope: string,
  normalize: (value: string | null, unmatched: Set<string>) => string | null,
  unmatched: Set<string>,
): string {
  if (scope === "*") return scope;
  return scope
    .split(",")
    .map((part) => normalize(part, unmatched) ?? part)
    .join(",");
}

// --- Email domain swap -------------------------------------------------
// Same swap as CLAUDE.md's "Email Domain Migration" — preserves the
// username prefix, only touches addresses actually on the old domain.

const OLD_DOMAIN = `@${process.env.OLD_EMAIL_DOMAIN ?? "coroand.co"}`;
const NEW_DOMAIN = `@${process.env.NEW_EMAIL_DOMAIN ?? "mimetta.co"}`;

function swapDomain(email: string | null): string | null {
  if (!email) return email;
  return email.toLowerCase().endsWith(OLD_DOMAIN) ? email.slice(0, -OLD_DOMAIN.length) + NEW_DOMAIN : email;
}

// --- Per-table migration -------------------------------------------------

interface RequestItemRow {
  cat_l1?: string | null;
  [key: string]: unknown;
}

interface RequestRow {
  request_id: string;
  department: string | null;
  cat_l1: string | null;
  items_json: RequestItemRow[] | null;
  requester_email: string | null;
  bo_approver: string | null;
  ceo_approver: string | null;
  accounting_user: string | null;
  po_uploaded_by: string | null;
  rejected_by: string | null;
}

async function migrateRequests(unmatchedDept: Set<string>, unmatchedCat: Set<string>): Promise<void> {
  const { data, error } = await admin
    .from("requests")
    .select(
      "request_id, department, cat_l1, items_json, requester_email, bo_approver, ceo_approver, accounting_user, po_uploaded_by, rejected_by",
    );
  if (error) throw error;
  const rows = (data ?? []) as RequestRow[];

  let changed = 0;
  for (const row of rows) {
    const nextItems = (row.items_json ?? []).map((item) => ({
      ...item,
      cat_l1: item.cat_l1 ? normalizeCategory(item.cat_l1, unmatchedCat) : item.cat_l1,
    }));

    const patch: Record<string, unknown> = {};
    const nextDepartment = normalizeDepartment(row.department, unmatchedDept);
    const nextCatL1 = normalizeCategory(row.cat_l1, unmatchedCat);
    const nextRequesterEmail = swapDomain(row.requester_email);
    const nextBoApprover = swapDomain(row.bo_approver);
    const nextCeoApprover = swapDomain(row.ceo_approver);
    const nextAccountingUser = swapDomain(row.accounting_user);
    const nextPoUploadedBy = swapDomain(row.po_uploaded_by);
    const nextRejectedBy = swapDomain(row.rejected_by);

    if (nextDepartment !== row.department) patch.department = nextDepartment;
    if (nextCatL1 !== row.cat_l1) patch.cat_l1 = nextCatL1;
    if (JSON.stringify(nextItems) !== JSON.stringify(row.items_json ?? [])) patch.items_json = nextItems;
    if (nextRequesterEmail !== row.requester_email) patch.requester_email = nextRequesterEmail;
    if (nextBoApprover !== row.bo_approver) patch.bo_approver = nextBoApprover;
    if (nextCeoApprover !== row.ceo_approver) patch.ceo_approver = nextCeoApprover;
    if (nextAccountingUser !== row.accounting_user) patch.accounting_user = nextAccountingUser;
    if (nextPoUploadedBy !== row.po_uploaded_by) patch.po_uploaded_by = nextPoUploadedBy;
    if (nextRejectedBy !== row.rejected_by) patch.rejected_by = nextRejectedBy;

    // request_id is never touched — CLAUDE.md: "Preserve all request_id
    // values exactly."
    if (Object.keys(patch).length === 0) continue;
    changed++;
    if (APPLY) {
      const { error: updateError } = await admin.from("requests").update(patch).eq("request_id", row.request_id);
      if (updateError) throw updateError;
    }
  }
  console.log(`requests: ${changed} row(s) ${APPLY ? "updated" : "would be updated"} (of ${rows.length})`);
}

interface RoleScopeRow {
  id: string;
  email: string | null;
  dept_scope: string;
  cat_l1_scope: string;
}

async function migrateRoles(unmatchedDept: Set<string>, unmatchedCat: Set<string>): Promise<void> {
  const { data, error } = await admin.from("roles").select("id, email, dept_scope, cat_l1_scope");
  if (error) throw error;
  const rows = (data ?? []) as RoleScopeRow[];

  let changed = 0;
  for (const row of rows) {
    const nextEmail = swapDomain(row.email);
    const nextDeptScope = normalizeScopeList(row.dept_scope, normalizeDepartment, unmatchedDept);
    const nextCatScope = normalizeScopeList(row.cat_l1_scope, normalizeCategory, unmatchedCat);

    const patch: Record<string, unknown> = {};
    if (nextEmail !== row.email) patch.email = nextEmail;
    if (nextDeptScope !== row.dept_scope) patch.dept_scope = nextDeptScope;
    if (nextCatScope !== row.cat_l1_scope) patch.cat_l1_scope = nextCatScope;

    if (Object.keys(patch).length === 0) continue;
    changed++;
    if (APPLY) {
      const { error: updateError } = await admin.from("roles").update(patch).eq("id", row.id);
      if (updateError) throw updateError;
    }
  }
  console.log(`roles: ${changed} row(s) ${APPLY ? "updated" : "would be updated"} (of ${rows.length})`);
}

interface DeptConfigRowMinimal {
  id: string;
  dept: string;
  bo_email: string | null;
}

async function migrateDeptConfig(unmatchedDept: Set<string>): Promise<void> {
  const { data, error } = await admin.from("dept_config").select("id, dept, bo_email");
  if (error) throw error;
  const rows = (data ?? []) as DeptConfigRowMinimal[];

  let changed = 0;
  for (const row of rows) {
    // '*' is the fallback-row wildcard (see CLAUDE.md "DeptConfig
    // Matching") — never a real department name to normalize.
    const nextDept = row.dept === "*" ? row.dept : (normalizeDepartment(row.dept, unmatchedDept) ?? row.dept);
    const nextBoEmail = swapDomain(row.bo_email);

    const patch: Record<string, unknown> = {};
    if (nextDept !== row.dept) patch.dept = nextDept;
    if (nextBoEmail !== row.bo_email) patch.bo_email = nextBoEmail;

    if (Object.keys(patch).length === 0) continue;
    changed++;
    if (APPLY) {
      const { error: updateError } = await admin.from("dept_config").update(patch).eq("id", row.id);
      if (updateError) throw updateError;
    }
  }
  console.log(`dept_config: ${changed} row(s) ${APPLY ? "updated" : "would be updated"} (of ${rows.length})`);
}

interface CategoryRowMinimal {
  id: string;
  department: string;
}

async function migrateCategories(unmatchedDept: Set<string>): Promise<void> {
  const { data, error } = await admin.from("categories").select("id, department");
  if (error) throw error;
  const rows = (data ?? []) as CategoryRowMinimal[];

  let changed = 0;
  for (const row of rows) {
    const nextDepartment =
      row.department === "*" ? row.department : (normalizeDepartment(row.department, unmatchedDept) ?? row.department);
    if (nextDepartment === row.department) continue;
    changed++;
    if (APPLY) {
      const { error: updateError } = await admin
        .from("categories")
        .update({ department: nextDepartment })
        .eq("id", row.id);
      if (updateError) throw updateError;
    }
  }
  console.log(`categories: ${changed} row(s) ${APPLY ? "updated" : "would be updated"} (of ${rows.length})`);
}

interface AuditLogRowMinimal {
  id: string;
  actor_email: string;
}

async function migrateAuditLog(): Promise<void> {
  const { data, error } = await admin.from("audit_log").select("id, actor_email");
  if (error) throw error;
  const rows = (data ?? []) as AuditLogRowMinimal[];

  let changed = 0;
  for (const row of rows) {
    const next = swapDomain(row.actor_email);
    if (next === row.actor_email || !next) continue;
    changed++;
    if (APPLY) {
      const { error: updateError } = await admin.from("audit_log").update({ actor_email: next }).eq("id", row.id);
      if (updateError) throw updateError;
    }
  }
  console.log(`audit_log: ${changed} row(s) ${APPLY ? "updated" : "would be updated"} (of ${rows.length})`);
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Running in APPLY mode — changes will be written."
      : "Running in DRY-RUN mode (default) — no changes will be written. Pass --apply to write.",
  );
  console.log(`Supabase project: ${SUPABASE_URL}`);
  console.log("");

  const unmatchedDept = new Set<string>();
  const unmatchedCat = new Set<string>();

  await migrateRequests(unmatchedDept, unmatchedCat);
  await migrateRoles(unmatchedDept, unmatchedCat);
  await migrateDeptConfig(unmatchedDept);
  await migrateCategories(unmatchedDept);
  await migrateAuditLog();

  console.log("");
  console.log("=== Migration report ===");
  if (unmatchedDept.size > 0) {
    console.log(`Unmatched department values (${unmatchedDept.size}) — not in DEPARTMENT_NAME_MAP, left as-is:`);
    Array.from(unmatchedDept).forEach((d) => console.log(`  - ${JSON.stringify(d)}`));
  } else {
    console.log("No unmatched department values.");
  }
  if (unmatchedCat.size > 0) {
    console.log(`Unmatched category values (${unmatchedCat.size}) — not in CATEGORY_NAME_MAP, left as-is:`);
    Array.from(unmatchedCat).forEach((c) => console.log(`  - ${JSON.stringify(c)}`));
  } else {
    console.log("No unmatched category values.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
