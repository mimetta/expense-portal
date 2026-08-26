// Imports the budget Google Sheet's wide export (one row per
// bu/department/product/cat_l1/cat_l2, one column per month) into the
// `budgets` table created by supabase/migrations/016_budgets.sql, unpivoted
// to one row per month.
//
// Plain Node script — not part of the Next.js app. Same conventions as
// scripts/migrate-from-sheets.ts and scripts/import-expensedb-requests.ts:
// DRY-RUN BY DEFAULT, --apply to write, reads .env.local itself.
//
//   npx tsx scripts/import-budget.ts --file=budget-2026.csv --year=2026
//   npx tsx scripts/import-budget.ts --file=budget-2026.csv --year=2026 --apply
//   npm run import:budget -- --file=budget-2026.csv --year=2026
//
// Expected CSV header (case/spacing insensitive, extra columns ignored):
//   bu, department, product, cat_l1, cat_l2, Jan, Feb, ... Dec
//
// ---------------------------------------------------------------------------
// DEPARTMENT NAME SUFFIX CORRECTION — read this before changing it.
//
// normalizeDepartment/normalizeCategory are imported from
// migrate-from-sheets.ts rather than copied, so there is exactly one
// DEPARTMENT_NAME_MAP/CATEGORY_NAME_MAP in this repo. But that map is known
// to be wrong in one specific way, documented at length in CLAUDE.md
// ("Legacy data migration script") and in a comment in the script itself: it
// maps to display-suffixed names like "General Administrative (GA)" and
// "Operations/Fulfillment (OPF)", whereas the "(ABBREV)" part is a UI-only
// label (lib/constants.ts#DEPARTMENT_ABBREV, appended client-side in
// dropdowns) that is never part of the stored `department` value.
//
// For this script that is not a cosmetic problem. budgets.department is
// joined to requests.department by exact string equality inside
// lib/spend.ts, so writing the suffixed form would produce a budgets table
// whose rows silently never match any actual spend — every segment would
// show budget with no actual, and every actual would show up as "no budget
// set". So the suffix is stripped after normalization, below, and the
// stripped result is checked against lib/constants.ts#DEPARTMENTS with a
// warning for anything that still does not match.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeCategory, normalizeDepartment } from "./migrate-from-sheets";
import { DEPARTMENTS } from "../lib/constants";

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

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

// --- CSV parsing -----------------------------------------------------------
// RFC4180-compliant enough for the sheet exports this repo deals with
// (quoted fields, embedded commas/newlines, ""-escaped quotes). Same reason
// import-expensedb-requests.ts has its own: there is no CSV dependency in
// this repo and this does not warrant adding one.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function headerKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

// "1,234.50", "฿1,234", "(500)" (accounting negative), "" -> number | null
function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "" || s === "-" || s === "—") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[฿,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Strips the display-only "(ABBREV)" suffix migrate-from-sheets.ts's
// DEPARTMENT_NAME_MAP appends. See the header comment for why.
function stripAbbrevSuffix(dept: string | null): string | null {
  if (!dept) return dept;
  return dept.replace(/\s*\([A-Za-z&/ ]+\)\s*$/, "").trim();
}

function nullIfBlank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

interface BudgetInsert {
  bu: string;
  department: string;
  product: string | null;
  cat_l1: string | null;
  cat_l2: string | null;
  fiscal_year: number;
  month: number;
  amount: number;
}

async function main(): Promise<void> {
  const file = argValue("file");
  const yearArg = argValue("year");

  if (!file || !yearArg) {
    console.error("Usage: npx tsx scripts/import-budget.ts --file=<path.csv> --year=<YYYY> [--apply]");
    process.exit(1);
  }
  const fiscalYear = Number(yearArg);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    console.error(`Invalid --year=${yearArg}`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked .env.local and the environment).");
    process.exit(1);
  }

  console.log(
    APPLY
      ? "Running in APPLY mode — rows will be written."
      : "Running in DRY-RUN mode (default) — no changes will be written. Pass --apply to write.",
  );
  console.log(`File: ${file}`);
  console.log(`Fiscal year: ${fiscalYear}`);
  console.log("");

  const rows = parseCsv(readFileSync(resolve(process.cwd(), file), "utf8"));
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = rows[0].map(headerKey);
  const col = (name: string) => header.indexOf(name);
  const buIdx = col("bu");
  const deptIdx = col("department");
  const productIdx = col("product");
  const l1Idx = col("catl1");
  const l2Idx = col("catl2");

  if (buIdx === -1 || deptIdx === -1) {
    console.error(`CSV must have 'bu' and 'department' columns. Found: ${rows[0].join(", ")}`);
    process.exit(1);
  }

  const monthIdx = MONTH_KEYS.map((m) => header.findIndex((h) => h === m || h.startsWith(m)));
  const missingMonths = MONTH_KEYS.filter((_, i) => monthIdx[i] === -1);
  if (missingMonths.length > 0) {
    console.warn(`⚠️  No column found for: ${missingMonths.join(", ")} — those months are skipped.`);
  }

  const unmatchedDept = new Set<string>();
  const unmatchedCat = new Set<string>();
  const notCanonical = new Set<string>();

  const inserts: BudgetInsert[] = [];
  let skippedZero = 0;
  let skippedBlank = 0;
  let skippedNoBu = 0;

  for (const raw of rows.slice(1)) {
    const bu = nullIfBlank(raw[buIdx]);
    const deptRaw = nullIfBlank(raw[deptIdx]);
    if (!bu || !deptRaw) {
      skippedNoBu++;
      continue;
    }

    const department = stripAbbrevSuffix(normalizeDepartment(deptRaw, unmatchedDept));
    if (!department) {
      skippedNoBu++;
      continue;
    }
    if (!(DEPARTMENTS as readonly string[]).includes(department)) {
      notCanonical.add(department);
    }

    const product = productIdx === -1 ? null : nullIfBlank(raw[productIdx]);
    const catL1 =
      l1Idx === -1 ? null : normalizeCategory(nullIfBlank(raw[l1Idx]), unmatchedCat);
    const catL2 =
      l2Idx === -1 ? null : normalizeCategory(nullIfBlank(raw[l2Idx]), unmatchedCat);

    for (let m = 0; m < 12; m++) {
      const idx = monthIdx[m];
      if (idx === -1) continue;
      const amount = parseAmount(raw[idx]);
      if (amount === null) {
        skippedBlank++;
        continue;
      }
      if (amount === 0) {
        skippedZero++;
        continue;
      }
      inserts.push({
        bu,
        department,
        product,
        cat_l1: catL1,
        cat_l2: catL2,
        fiscal_year: fiscalYear,
        month: m + 1,
        amount,
      });
    }
  }

  console.log(`Parsed ${rows.length - 1} sheet rows -> ${inserts.length} monthly budget rows.`);
  console.log(`  skipped: ${skippedZero} zero, ${skippedBlank} blank, ${skippedNoBu} missing bu/department.`);
  const totalAmount = inserts.reduce((s, r) => s + r.amount, 0);
  console.log(`  total budget: ${totalAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  console.log("");

  if (inserts.length > 0) {
    console.log("Sample (first 5):");
    inserts.slice(0, 5).forEach((r) =>
      console.log(
        `  ${r.bu} | ${r.department} | ${r.cat_l1 ?? "-"} | ${r.cat_l2 ?? "-"} | ${fiscalYear}-${String(r.month).padStart(2, "0")} | ${r.amount}`,
      ),
    );
    console.log("");
  }

  if (APPLY) {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      // Upsert on the budgets_uniq index from migration 016. Note the
      // conflict target is the INDEX's expression list, so it is named here
      // by its column list; re-running with a corrected sheet updates the
      // amount in place rather than duplicating the row.
      const { error } = await supabase
        .from("budgets")
        .upsert(chunk, {
          onConflict: "bu,department,product,cat_l1,cat_l2,fiscal_year,month",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error(`Failed writing rows ${i}-${i + chunk.length}:`, error);
        process.exit(1);
      }
      written += chunk.length;
      console.log(`  wrote ${written}/${inserts.length}`);
    }
  }

  // --- report (same shape as migrate-from-sheets.ts's) ---
  console.log("");
  console.log("=== Budget import report ===");
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
  if (notCanonical.size > 0) {
    console.log("");
    console.log(
      `⚠️  ${notCanonical.size} department value(s) are not in lib/constants.ts#DEPARTMENTS even after`,
    );
    console.log("   normalization. These will NOT join to requests.department and will show as");
    console.log("   budget with no actual on the spend report:");
    Array.from(notCanonical).forEach((d) => console.log(`  - ${JSON.stringify(d)}`));
  }
  if (!APPLY) {
    console.log("");
    console.log("Dry run complete — nothing written. Re-run with --apply to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
