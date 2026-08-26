// Read-only check — writes nothing, ever. No --apply flag.
//
// Investigating a bug Darling reported: adding a new Category L1/L2 row
// under an existing Segment (department) in Settings > Category L1/L2
// Management appears to create a whole separate new segment instead of
// adding to the existing one.
//
// Working theory: /submit's Segment dropdown (GET /api/departments) is
// built from the DISTINCT `department` values actually present in the
// `categories` table (see CLAUDE.md "Department picker (dynamic, not
// hardcoded)"). If two rows are meant to be "the same" segment but their
// department string differs even slightly (case, whitespace, a stray
// character), they show up as two separate entries in that dropdown — this
// exact class of bug already happened once before in this project
// ("Marketing (MKT)" vs "Marketing").
//
// This script groups every categories.department value by its
// trimmed+lowercased form, and flags any group that contains more than one
// distinct RAW string — those are the candidates for "looks like the same
// segment to a human, but is two different strings to the database."
//
// Run:
//   npx tsx scripts/check-duplicate-segments.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
// .env.local, same convention as scripts/migrate-from-sheets.ts.

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

function normKey(s: string): string {
  // Also strips zero-width/invisible characters, which don't show up when
  // eyeballing a value in the Settings table but do make two strings unequal.
  // eslint-disable-next-line no-control-regex
  return s.trim().toLowerCase().replace(/[​-‍﻿]/g, "");
}

async function main() {
  console.log("Fetching categories.department, bu...\n");

  const { data, error } = await admin.from("categories").select("id, bu, department, cat_l1, cat_l2");
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as { id: number; bu: string; department: string; cat_l1: string | null; cat_l2: string | null }[];
  console.log(`Total category rows: ${rows.length}\n`);

  const groups = new Map<string, Set<string>>();
  const rowsByRaw = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normKey(r.department);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(r.department);
    const rawKey = r.department;
    if (!rowsByRaw.has(rawKey)) rowsByRaw.set(rawKey, []);
    rowsByRaw.get(rawKey)!.push(r);
  }

  const suspicious = Array.from(groups.entries()).filter(([, variants]) => variants.size > 1);

  if (suspicious.length === 0) {
    console.log("No near-duplicate department strings found (case/whitespace-insensitive check).");
  } else {
    console.log(`Found ${suspicious.length} segment(s) with more than one distinct raw string:\n`);
    for (const [normalized, variants] of suspicious) {
      console.log(`  Normalized as "${normalized}":`);
      for (const variant of variants) {
        const matching = rowsByRaw.get(variant) ?? [];
        console.log(
          `    "${variant}" (length ${variant.length}) — ${matching.length} row(s), e.g. bu=${matching[0]?.bu} cat_l1=${matching[0]?.cat_l1 ?? "-"}`,
        );
      }
      console.log("");
    }
  }

  // Also show the exact list of distinct raw department strings, since a
  // one-character/whitespace difference might not visually stand out even
  // in the console above.
  console.log("--- All distinct department strings (raw, with char codes for the first 3 chars) ---");
  const distinctDepartments = Array.from(new Set(rows.map((r) => r.department))).sort();
  for (const d of distinctDepartments) {
    const codes = Array.from(d.slice(0, 3)).map((c) => c.charCodeAt(0));
    const count = rows.filter((r) => r.department === d).length;
    console.log(`  "${d}"  (${count} rows, first-char-codes: ${codes.join(",")})`);
  }
}

main();
