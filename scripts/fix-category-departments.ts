// Fixes a real data bug found while investigating Darling's report that
// adding a new Category L1/L2 row under an existing Segment appears to
// create a whole separate new segment.
//
// Root cause (confirmed via scripts/check-duplicate-segments.ts): the
// `categories` table's `department` column holds legacy/GAS-style names for
// roughly half its rows — abbreviation suffixes like "(GA)"/"(MKT)"/"(RD)",
// or altogether different wording ("Fulfillment operation", "People (HR)",
// "New Store Investment", "COGs") — instead of the canonical, unsuffixed
// names in lib/constants.ts#DEPARTMENTS that every other table in this app
// (requests.department, dept_config.dept, roles.dept_scope) already uses.
// Since /submit's Segment dropdown (GET /api/departments) is built from the
// DISTINCT department values actually present in `categories`, and the "Add
// New Category" form's Segment field is a dropdown of the CANONICAL names,
// picking an existing-looking segment and adding a category under it
// creates a second, different department string — which then shows up as
// its own separate segment. This is the same bug class flagged once before
// in this project for "Marketing (MKT)" vs "Marketing", just never fully
// cleaned up (or reintroduced later) across several more departments.
//
// This script normalizes every non-canonical department value below to its
// canonical form. Since renaming can make two previously-distinct rows
// collide (same bu/department/cat_l1/cat_l2 after the rename), it also
// detects those collisions and reports which duplicate would be deleted
// (keeping the lowest id) rather than leaving an exact duplicate row.
//
// ⚠️ 2/7 of this map's targets were WRONG and have since been reversed —
// "New Store Investment" and "People (HR)" are the real, correct segment
// names (confirmed by Darling 2026-07-24), not legacy variants of "Store
// Investment"/"People & HR & System" as guessed here. This script already
// ran and merged them the wrong way; scripts/fix-department-names-
// everywhere.ts reverses that (and also covers requests/dept_config/roles,
// which this script never touched) — see its RENAME_MAP and the comment
// above lib/constants.ts#DEPARTMENTS for the full story. Left as-is here as
// a historical record of what this script actually did when it ran; do not
// re-run this file — use fix-department-names-everywhere.ts instead.
//
// Dry-run by default; pass --apply to write. Same convention as every other
// script in this repo.
//
// Run:
//   npx tsx scripts/fix-category-departments.ts              (dry run)
//   npx tsx scripts/fix-category-departments.ts --apply       (writes)

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

// lib/constants.ts#DEPARTMENTS — the canonical, correct list every other
// table in this app already uses.
const CANONICAL_DEPARTMENTS = [
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
];

// Found live in categories.department via scripts/check-duplicate-segments.ts.
const RENAME_MAP: Record<string, string> = {
  "COGs": "COG",
  "Fulfillment operation": "Operations/Fulfillment",
  "General Administrative (GA)": "General Administrative",
  "Lab Instrument Investment (RD)": "Lab Instrument Investment",
  "Marketing (MKT)": "Marketing",
  "New Store Investment": "Store Investment",
  "People (HR)": "People & HR & System",
};

interface Row {
  id: number;
  bu: string;
  department: string;
  cat_l1: string | null;
  cat_l2: string | null;
  product: string | null;
}

function dedupeKey(r: { bu: string; department: string; cat_l1: string | null; cat_l2: string | null }) {
  return `${r.bu}||${r.department}||${r.cat_l1 ?? ""}||${r.cat_l2 ?? ""}`;
}

async function main() {
  console.log(APPLY ? "APPLY MODE — this will write to the database.\n" : "DRY RUN — no writes will be made. Pass --apply to write for real.\n");
  console.log("Fetching all categories...\n");

  const { data, error } = await admin.from("categories").select("id, bu, department, cat_l1, cat_l2, product").order("id", { ascending: true });
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`Total category rows: ${rows.length}\n`);

  // Anything not canonical and not in our rename map — flag for manual
  // attention rather than guessing.
  const unknown = rows.filter((r) => !CANONICAL_DEPARTMENTS.includes(r.department) && !(r.department in RENAME_MAP));
  if (unknown.length > 0) {
    console.log(`⚠️  ${unknown.length} row(s) have a department value that's neither canonical nor in the rename map:`);
    const distinctUnknown = Array.from(new Set(unknown.map((r) => r.department)));
    for (const d of distinctUnknown) {
      console.log(`  "${d}" — ${unknown.filter((r) => r.department === d).length} row(s)`);
    }
    console.log("These are left untouched. Add them to RENAME_MAP if they should be normalized too.\n");
  }

  // Simulate the rename to find post-rename duplicates.
  const finalKeyCounts = new Map<string, Row[]>();
  for (const r of rows) {
    const newDept = RENAME_MAP[r.department] ?? r.department;
    const key = dedupeKey({ ...r, department: newDept });
    if (!finalKeyCounts.has(key)) finalKeyCounts.set(key, []);
    finalKeyCounts.get(key)!.push(r);
  }

  const renamePlan: { id: number; oldDept: string; newDept: string }[] = [];
  const deletePlan: { id: number; reason: string }[] = [];

  for (const [, group] of finalKeyCounts) {
    if (group.length === 1) {
      const r = group[0];
      const newDept = RENAME_MAP[r.department];
      if (newDept) renamePlan.push({ id: r.id, oldDept: r.department, newDept });
      continue;
    }
    // More than one row collides on (bu, new department, cat_l1, cat_l2) —
    // keep the lowest id, rename it if needed, delete the rest.
    const sorted = [...group].sort((a, b) => a.id - b.id);
    const keeper = sorted[0];
    const newDept = RENAME_MAP[keeper.department];
    if (newDept) renamePlan.push({ id: keeper.id, oldDept: keeper.department, newDept });
    for (const dup of sorted.slice(1)) {
      deletePlan.push({ id: dup.id, reason: `duplicate of id ${keeper.id} after normalizing department` });
    }
  }

  console.log(`--- Rename plan: ${renamePlan.length} row(s) ---`);
  const byPair = new Map<string, number>();
  for (const p of renamePlan) {
    const key = `${p.oldDept} -> ${p.newDept}`;
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of byPair) {
    console.log(`  ${pair}: ${count} row(s)`);
  }

  console.log(`\n--- Delete plan (exact duplicates created by the rename): ${deletePlan.length} row(s) ---`);
  for (const d of deletePlan) {
    console.log(`  id=${d.id}: ${d.reason}`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write these changes for real.");
    return;
  }

  console.log("\nApplying deletes first (so renames never collide)...");
  for (const d of deletePlan) {
    const { error: delError } = await admin.from("categories").delete().eq("id", d.id);
    if (delError) {
      console.error(`Delete failed for id=${d.id}:`, delError.message);
      process.exit(1);
    }
  }
  console.log(`Deleted ${deletePlan.length} duplicate row(s).`);

  console.log("Applying renames...");
  // Group by target department for fewer round trips (still per-source-value
  // since .in() needs the OLD department to match).
  const byOldDept = new Map<string, number[]>();
  for (const p of renamePlan) {
    if (!byOldDept.has(p.oldDept)) byOldDept.set(p.oldDept, []);
    byOldDept.get(p.oldDept)!.push(p.id);
  }
  for (const [oldDept, ids] of byOldDept) {
    const newDept = RENAME_MAP[oldDept];
    const { error: updateError } = await admin.from("categories").update({ department: newDept }).in("id", ids);
    if (updateError) {
      console.error(`Update failed for department="${oldDept}":`, updateError.message);
      process.exit(1);
    }
    console.log(`  "${oldDept}" -> "${newDept}": ${ids.length} row(s) updated`);
  }

  console.log(`\nDone. ${renamePlan.length} rows renamed, ${deletePlan.length} duplicate rows deleted.`);
}

main();
