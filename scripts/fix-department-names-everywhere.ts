// Extends scripts/fix-category-departments.ts's fix to every OTHER table
// that stores a department/segment string — not just `categories`.
//
// Root cause of Darling's report: the earlier fix
// (scripts/fix-category-departments.ts) only normalized `categories.department`
// (which feeds /submit's Segment dropdown via GET /api/departments). It never
// touched `requests.department`, `dept_config.dept`, or `roles.dept_scope` —
// so a request submitted back when the dropdown still offered a legacy name
// (e.g. "New Store Investment") still has that exact string sitting in
// requests.department today. A BO's dept_scope (or dept_config's routing row)
// now uses the canonical name ("Store Investment"), so `scopeMatches()` /
// `matchDeptConfig()` silently never matches that request — it just doesn't
// show up in BO Approvals, with no error anywhere.
//
// This script checks + fixes all four department-bearing columns in one pass,
// using the exact same RENAME_MAP as fix-category-departments.ts (kept
// byte-for-byte identical — do not let these two maps drift apart):
//   - requests.department        (plain string)
//   - dept_config.dept           (plain string, '*' wildcard passes through)
//   - roles.dept_scope           (comma-separated list, '*' wildcard passes through)
//   - categories.department      (plain string — re-checked defensively;
//                                  should already be all-canonical after the
//                                  last run, this just confirms that)
//
// Any value that's neither canonical nor in RENAME_MAP is reported and left
// untouched — same "flag, don't guess" convention as every other script in
// this repo.
//
// Dry-run by default; pass --apply to write. Idempotent — re-running after a
// successful --apply reports zero rows to change.
//
// Run:
//   npx tsx scripts/fix-department-names-everywhere.ts              (dry run)
//   npx tsx scripts/fix-department-names-everywhere.ts --apply       (writes)

import { readFileSync } from "node:fs";
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

// lib/constants.ts#DEPARTMENTS — "New Store Investment" and "People (HR)"
// are deliberately the canonical spellings here (not "Store Investment"/
// "People & HR & System") — see the comment above DEPARTMENTS in
// lib/constants.ts for why (Darling confirmed 2026-07-24 these are the
// real, correct segment names, reversing this script's original guess).
const CANONICAL_DEPARTMENTS = [
  "Marketing",
  "R&D",
  "Factory",
  "Factory Investment",
  "New Store Investment",
  "Operations/Fulfillment",
  "Retail",
  "General Administrative",
  "People (HR)",
  "Merchandise",
  "OEM",
  "Lab Instrument Investment",
  "COG",
];

// 5 of these 7 match scripts/fix-category-departments.ts's original map
// (kept in sync — add any newly-discovered legacy variant to both files).
// The other 2 are the OPPOSITE direction from that script's original guess:
// "Store Investment" and "People & HR & System" turned out to be the wrong
// merge target — "New Store Investment"/"People (HR)" are the real names,
// so this reverses anything already merged into the old target (including
// categories.department, which fix-category-departments.ts already touched)
// and keeps normalizing it going forward.
const RENAME_MAP: Record<string, string> = {
  "COGs": "COG",
  "Fulfillment operation": "Operations/Fulfillment",
  "General Administrative (GA)": "General Administrative",
  "Lab Instrument Investment (RD)": "Lab Instrument Investment",
  "Marketing (MKT)": "Marketing",
  "Store Investment": "New Store Investment",
  "People & HR & System": "People (HR)",
};

function normalize(value: string): string {
  return RENAME_MAP[value] ?? value;
}

function isKnown(value: string): boolean {
  return value === "*" || CANONICAL_DEPARTMENTS.includes(value) || value in RENAME_MAP;
}

interface ColumnPlan {
  table: string;
  column: string;
  // Primary key column to select/match on — `requests` uses `request_id`
  // (EXP-YYYY-MM-NNNNNN), everything else here uses the default `id`.
  idColumn?: string;
  // Fetches [{ id, raw }] for every row where `raw` (the plain-string case)
  // or every comma-separated token (the list case) might need normalizing.
  kind: "plain" | "csv-list";
}

async function auditAndFix(plan: ColumnPlan) {
  const { table, column, kind } = plan;
  const idColumn = plan.idColumn ?? "id";
  console.log(`\n=== ${table}.${column} (${kind}) ===`);

  const { data, error } = await admin.from(table).select(`${idColumn}, ${column}`);
  if (error) {
    console.error(`  Query failed: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  console.log(`  Total rows: ${rows.length}`);

  const unmatched = new Set<string>();
  let toChange: { id: unknown; oldValue: string; newValue: string }[] = [];

  for (const row of rows) {
    const raw = row[column] as string | null;
    if (!raw) continue;

    if (kind === "plain") {
      if (!isKnown(raw)) unmatched.add(raw);
      const normalized = normalize(raw);
      if (normalized !== raw) {
        toChange.push({ id: row[idColumn], oldValue: raw, newValue: normalized });
      }
    } else {
      const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
      let changedAny = false;
      const newTokens = tokens.map((t) => {
        if (!isKnown(t)) unmatched.add(t);
        const n = normalize(t);
        if (n !== t) changedAny = true;
        return n;
      });
      if (changedAny) {
        toChange.push({ id: row[idColumn], oldValue: raw, newValue: newTokens.join(",") });
      }
    }
  }

  if (unmatched.size > 0) {
    console.log(`  ⚠️  ${unmatched.size} value(s) neither canonical nor in RENAME_MAP (left untouched):`);
    for (const u of unmatched) console.log(`    "${u}"`);
  }

  console.log(`  Rows to change: ${toChange.length}`);
  const byPair = new Map<string, number>();
  for (const c of toChange) {
    const key = `"${c.oldValue}" -> "${c.newValue}"`;
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of byPair) {
    console.log(`    ${pair}: ${count} row(s)`);
  }

  if (!APPLY || toChange.length === 0) return;

  for (const c of toChange) {
    const { error: updateError } = await admin.from(table).update({ [column]: c.newValue }).eq(idColumn, c.id as string | number);
    if (updateError) {
      console.error(`  Update failed for id=${c.id}: ${updateError.message}`);
      process.exit(1);
    }
  }
  console.log(`  Applied ${toChange.length} update(s).`);
}

async function main() {
  console.log(
    APPLY
      ? "APPLY MODE — this will write to the database.\n"
      : "DRY RUN — no writes will be made. Pass --apply to write for real.\n",
  );

  await auditAndFix({ table: "requests", column: "department", kind: "plain", idColumn: "request_id" });
  await auditAndFix({ table: "dept_config", column: "dept", kind: "plain" });
  await auditAndFix({ table: "roles", column: "dept_scope", kind: "csv-list" });
  // Re-checked defensively — should already be clean after
  // fix-category-departments.ts's earlier run.
  await auditAndFix({ table: "categories", column: "department", kind: "plain" });

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write these changes for real.");
  } else {
    console.log("\nDone.");
  }
}

main();
