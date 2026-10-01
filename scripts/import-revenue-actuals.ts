// Import revenue ACTUALS from the ONEST revenue spreadsheet's per-year tabs,
// exported as CSV.
//
//   npx tsx scripts/import-revenue-actuals.ts <file.csv> <fiscalYear> [more...]
//   npx tsx scripts/import-revenue-actuals.ts <file.csv> <fiscalYear> --apply
//
// DRY RUN BY DEFAULT — reports what it would write and changes nothing.
// `--apply` writes. Same convention as scripts/migrate-from-sheets.ts.
//
// THE FILE PATHS ARE ARGUMENTS AND NO FIGURES LIVE IN THIS FILE. The exports
// are raw financial data, gitignored, and must stay out of the repository;
// this script is committed, they are not.
//
// ---------------------------------------------------------------------------
// THE PARSING AND VALIDATION LIVE IN lib/revenue-sheet.ts, NOT HERE
//
// This script and the daily Sheets sync (lib/revenue-sync.ts) read the same
// workbook, so they share one implementation — including the two faults found
// the hard way here: the quoted blank header line that produced a phantom
// channel, and the "Loopers" row that exists in the sheet and not in the
// portal. See that file for what each check is for.
//
// What remains in this file is the CSV-specific part: read a path, feed the
// rows in, print a dry-run report.
//
// VALIDATION IS SHARED BUT THE RESPONSE IS NOT. The sync refuses the whole run
// on any problem, because it is unattended. This script is run by a person who
// can see the output, so it REPORTS every problem and still refuses to --apply
// — same checks, same refusal to write, more detail on the way out.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseCsv, parseSheetTable, validateSheet, buildEntries,
} from "../lib/revenue-sheet";

const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const line of envText.split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

/** Only this BU: the workbook is ONEST's. SV's revenue lives elsewhere and is not touched. */
const SHEET_BU = "ONEST";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const pairs: { path: string; year: number }[] = [];
  const positional = argv.filter((a) => a !== "--apply");
  for (let i = 0; i + 1 < positional.length; i += 2) {
    pairs.push({ path: positional[i], year: Number(positional[i + 1]) });
  }
  if (pairs.length === 0 || pairs.some((p) => !Number.isInteger(p.year))) {
    console.error("usage: import-revenue-actuals.ts <file.csv> <fiscalYear> [<file.csv> <fiscalYear>...] [--apply]");
    process.exit(2);
  }

  const { createAdminClient } = await import("../lib/supabase/admin");
  const { saveRevenueActuals } = await import("../lib/revenue-goals");
  const { loadPerson, projectAllRoles } = await import("../lib/person");
  const admin = createAdminClient();

  // ACTIVE channels only, matching the sync. An inactive channel satisfying
  // the "every portal channel appears" check would mask a real gap.
  const { data: chanRows, error } = await admin
    .from("revenue_channels").select("id, bu, channel, status, active").eq("bu", SHEET_BU).eq("active", true);
  if (error) throw error;
  const portalChannels = (chanRows ?? []).map((c) => ({
    id: c.id as string, channel: c.channel as string,
    closed: (c as { status?: string | null }).status === "closed",
  }));

  // The write goes through saveRevenueActuals, so the CEO/SUPERADMIN gate and
  // the audit row are the same ones the UI uses — not a direct table write.
  const person = await loadPerson("admin@mimetta.co");
  if (!person) throw new Error("admin@mimetta.co not found");
  const viewer = { email: person.email, name: person.email, allRoles: projectAllRoles(person), chapter: person.chapter, person } as never;

  const now = new Date();
  let exitCode = 0;

  for (const { path, year } of pairs) {
    console.log(`\n=== ${path}  ->  FY${year} ===`);
    const rows = parseCsv(readFileSync(path, "utf8").replace(/^\ufeff/, ""));
    const parsed = parseSheetTable(rows);
    const verdict = validateSheet(parsed, portalChannels, rows);

    console.log(`  header row: ${parsed.headerRowIndex < 0 ? "NOT FOUND" : `index ${parsed.headerRowIndex}`}`);
    console.log(`  channel rows: ${parsed.channels.length}`);
    console.log(`  channels sum ${money(verdict.summed)} vs sheet total ${verdict.stated === null ? "(absent)" : money(verdict.stated)}`
      + ` — ${verdict.stated !== null && Math.abs(verdict.summed - verdict.stated) < 0.01 ? "RECONCILES" : "see problems"}`);
    for (const r of verdict.renames) console.log(`  name mapped: ${r}`);

    if (!verdict.ok) {
      console.error(`  *** ${verdict.problems.length} VALIDATION PROBLEM(S) — NOTHING WILL BE WRITTEN:`);
      for (const p of verdict.problems) console.error(`      [${p.code}] ${p.message}`);
      exitCode = 1;
      continue;
    }

    const built = buildEntries(verdict.matched, parsed.totalRow, year, now);
    const future = built.nulledMonths.filter((n) => n.reason === "future").map((n) => n.month);
    const allZero = built.nulledMonths.filter((n) => n.reason === "all_zero").map((n) => n.month);
    console.log(`  matched channels: ${verdict.matched.length}/${parsed.channels.length}`);
    console.log(`  cells: ${built.entries.length}  (NULL months — future: [${future.join(", ")}], all-zero: [${allZero.join(", ")}]; genuine zeros kept: ${built.genuineZeros})`);
    console.log(`  value imported: ${money(built.value)}`);

    if (!apply) { console.log("  DRY RUN — nothing written. Re-run with --apply."); continue; }
    const res = await saveRevenueActuals(year, built.entries, viewer, "sheet");
    console.log(`  written: ${res.written} figures, cleared: ${res.cleared}`);
  }

  if (!apply) console.log("\nDry run complete. Add --apply to write.");
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
