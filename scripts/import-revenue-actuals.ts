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
// WHAT IT READS
//
// Column A is the channel name, columns B..M are Jan..Dec. Everything to the
// right is a separate product-level block and is ignored. This is the
// PRESENTATION layout, which is exactly what docs/revenue-actual-mockup.html
// warns will break "the first time someone inserts a column" — the intended
// end state is a REVENUE_SYNC tab with plain columns. Until that exists this
// script reads defensively: it locates nothing by column offset beyond A..M,
// skips any row whose month cells are not all numeric, and refuses to guess
// at a channel it cannot match exactly.
//
// A "Total sales by Channel" row is present and is SKIPPED — it is a total,
// not a channel. The script checks the channel rows sum to it and says so,
// which is the cheapest available proof that the column window is right.
//
// ---------------------------------------------------------------------------
// ZERO IS NOT NULL, AND THE SHEET CANNOT TELL THEM APART
//
// The sheet writes 0.00 both for "this month genuinely took nothing" and for
// "this month has not happened yet". Importing the second as 0 would assert
// the business took no revenue in a month nobody has lived through, and every
// percentage built on it would be a lie — the exact failure migration 040
// exists to prevent.
//
// So the split is made on the calendar, which is the only reliable signal:
//
//   month is in the FUTURE  -> NULL ("not yet known"), whatever the sheet says
//   month is past or current -> the sheet's value, INCLUDING a genuine 0
//
// The current month is imported as-is: it is real data for a part month, and
// the report already labels the current month "partial month" and suppresses
// its of-goal comparison, so a partial figure is handled correctly there.
//
// ---------------------------------------------------------------------------
// UNMATCHED CHANNELS ARE SKIPPED, NEVER INVENTED
//
// The mockup lists "what happens when the sheet holds a channel the portal
// does not" as an open decision. This script takes the conservative half:
// it reports the channel and its amount, imports nothing for it, and exits
// non-zero under --apply so the run cannot pass unnoticed. Creating channels
// from a spreadsheet would let a typo in the sheet silently add a revenue
// stream to the portal.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const TOTAL_ROW_PREFIX = "totalsales";

/** Match on alphanumerics only, so "Lofteyes"/"Loft Eyes" and "Line OA"/"LINE OA" line up. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * CSV -> rows of cells. Handles quoted fields containing commas AND NEWLINES.
 *
 * The newline case is not hypothetical: the 2026 tab's first header cell is a
 * quoted blank line. Splitting on "\n" first — the obvious shortcut — fused
 * that header into a single giant field and produced a phantom channel row
 * whose twelve month cells were empty, i.e. a channel worth 0.00 named after
 * the entire header. It reconciled against the sheet total (0 adds nothing)
 * and only showed up because it landed in the unmatched list. Parse properly.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

interface SheetRow { name: string; months: number[] }

function readSheet(path: string): { channels: SheetRow[]; stated: number | null } {
  const text = readFileSync(path, "utf8").replace(/^\ufeff/, "");
  const channels: SheetRow[] = [];
  let stated: number | null = null;
  const rows = parseCsv(text);
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const months: number[] = [];
    let ok = true;
    for (let c = 1; c <= 12; c++) {
      const raw = (cells[c] ?? "").trim().replace(/,/g, "");
      if (raw === "") { months.push(0); continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) { ok = false; break; }
      months.push(n);
    }
    if (!ok) continue;                       // a header or label row, not a channel
    if (norm(name).startsWith(TOTAL_ROW_PREFIX)) { stated = months.reduce((s, v) => s + v, 0); continue; }
    channels.push({ name, months });
  }
  return { channels, stated };
}

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

  const { data: chanRows, error } = await admin
    .from("revenue_channels").select("id, bu, channel").eq("bu", SHEET_BU);
  if (error) throw error;
  const byName = new Map<string, { id: string; channel: string }>();
  for (const c of chanRows ?? []) byName.set(norm(c.channel as string), { id: c.id as string, channel: c.channel as string });

  // The write goes through saveRevenueActuals, so the CEO/SUPERADMIN gate and
  // the audit row are the same ones the UI uses — not a direct table write.
  const person = await loadPerson("admin@mimetta.co");
  if (!person) throw new Error("admin@mimetta.co not found");
  const viewer = { email: person.email, name: person.email, allRoles: projectAllRoles(person), chapter: person.chapter, person } as never;

  const now = new Date();
  const curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
  let exitCode = 0;

  for (const { path, year } of pairs) {
    console.log(`\n=== ${path}  ->  FY${year} ===`);
    const { channels, stated } = readSheet(path);
    const summed = channels.reduce((s, c) => s + c.months.reduce((a, v) => a + v, 0), 0);
    console.log(`  channel rows: ${channels.length}`);
    if (stated !== null) {
      const ok = Math.abs(summed - stated) < 0.01;
      console.log(`  channels sum ${money(summed)} vs sheet total ${money(stated)} — ${ok ? "RECONCILES" : "MISMATCH"}`);
      if (!ok) { console.error("  refusing this file: the column window does not reproduce the sheet's own total."); exitCode = 1; continue; }
    }

    const entries: { channelId: string; month: number; actual: number | null }[] = [];
    let futureNulled = 0, zeros = 0, unmatchedTotal = 0;
    const unmatched: string[] = [];
    for (const row of channels) {
      const hit = byName.get(norm(row.name));
      if (!hit) {
        unmatched.push(`${row.name} (${money(row.months.reduce((s, v) => s + v, 0))})`);
        unmatchedTotal += row.months.reduce((s, v) => s + v, 0);
        continue;
      }
      if (norm(row.name) !== norm(hit.channel) || row.name !== hit.channel) {
        console.log(`  name mapped: sheet "${row.name}" -> portal "${hit.channel}"`);
      }
      for (let m = 1; m <= 12; m++) {
        const future = year > curYear || (year === curYear && m > curMonth);
        if (future) { entries.push({ channelId: hit.id, month: m, actual: null }); futureNulled++; continue; }
        if (row.months[m - 1] === 0) zeros++;
        entries.push({ channelId: hit.id, month: m, actual: row.months[m - 1] });
      }
    }

    const matchedChannels = channels.length - unmatched.length;
    console.log(`  matched channels: ${matchedChannels}/${channels.length}`);
    if (unmatched.length) {
      console.log(`  *** UNMATCHED — NOT IMPORTED (${money(unmatchedTotal)}): ${unmatched.join(", ")}`);
      console.log(`      Add the channel in the portal first, or correct the sheet. Nothing is invented here.`);
      exitCode = 1;
    }
    console.log(`  cells: ${entries.length}  (future months written as NULL: ${futureNulled}; genuine zeros kept: ${zeros})`);
    const importedValue = entries.reduce((s, e) => s + (e.actual ?? 0), 0);
    console.log(`  value imported: ${money(importedValue)}`);

    if (!apply) { console.log("  DRY RUN — nothing written. Re-run with --apply."); continue; }
    const res = await saveRevenueActuals(year, entries, viewer, "sheet");
    console.log(`  written: ${res.written} figures, cleared: ${res.cleared}`);
  }

  if (!apply) console.log("\nDry run complete. Add --apply to write.");
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
