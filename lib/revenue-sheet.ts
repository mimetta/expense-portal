// Parsing and validation for the ONEST revenue workbook — the ONE
// implementation, shared by the CSV script and the daily Sheets sync.
//
// scripts/import-revenue-actuals.ts validated this layout against real data
// and found two faults the hard way (a quoted blank header line that produced
// a phantom channel; the "Loopers" channel that exists in the sheet and not in
// the portal). Both lessons live here now rather than in the script, so the
// unattended sync inherits them instead of reimplementing them.
//
// NO I/O AND NO next/headers IN THIS FILE. It takes a table of rows and returns
// a verdict, so the script (reading a CSV) and the route (reading the Sheets
// API) can both call it. Keep it that way — a server-only import here would
// stop the standalone script from running.
//
// ---------------------------------------------------------------------------
// WHY VALIDATION IS THE WHOLE SAFETY NET
//
// This reads a PRESENTATION layout: column A is the channel name, B..M are
// Jan..Dec, and everything right of M is a product-level block that must be
// ignored. Nothing about that is guaranteed by the sheet — it is a convention
// a person maintains, and it will break the first time someone inserts a
// column. Run unattended, a misread would quietly overwrite every revenue
// actual in the portal with figures from the wrong cells.
//
// So every check below refuses the WHOLE RUN rather than skipping a row. A
// partial import is the one outcome worse than no import: it leaves the portal
// holding a mixture of old and new figures with nothing to say which is which.

/** Match on alphanumerics only, so "Lofteyes"/"Loft Eyes" and "Line OA"/"LINE OA" line up. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const TOTAL_ROW_PREFIX = "totalsales";

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

export interface SheetChannelRow {
  name: string;
  /** Twelve values, Jan..Dec. Blank cells read as 0 — see the NULL rules below. */
  months: number[];
}

export interface ParsedSheet {
  channels: SheetChannelRow[];
  /** The sheet's own "Total sales by Channel" row, Jan..Dec, or null if absent. */
  totalRow: number[] | null;
  /** Index of the row the Jan..Dec header was found on, for diagnostics. */
  headerRowIndex: number;
}

export interface SheetProblem {
  code:
    | "no_header"
    | "header_out_of_order"
    | "unknown_channel"
    | "missing_channel"
    | "total_mismatch"
    | "no_total_row"
    | "no_channels";
  message: string;
}

/**
 * CSV -> rows of cells. Handles quoted fields containing commas AND NEWLINES.
 *
 * The newline case is not hypothetical: the 2026 tab's first header cell is a
 * quoted blank line. Splitting on "\n" first — the obvious shortcut — fused
 * that header into a single giant field and produced a phantom channel row
 * whose twelve month cells were empty, i.e. a channel worth 0.00 named after
 * the entire header. It reconciled against the sheet total (0 adds nothing)
 * and only showed up because it landed in the unmatched list. Parse properly.
 *
 * The Sheets API returns rows already structured, so the sync never calls this
 * — it exists for the CSV path only.
 */
export function parseCsv(text: string): string[][] {
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

/**
 * Find the Jan..Dec header, rather than assuming row 0.
 *
 * Assuming the first row would be wrong for this workbook — its 2026 tab opens
 * with a quoted blank line — and "assume an offset" is exactly the habit that
 * makes a presentation layout dangerous to read. Scanning also means the
 * failure is specific: "no Jan..Dec header" instead of silently reading labels
 * as figures.
 *
 * Returns -1 if no row has twelve month names in columns B..M, and the index
 * of the first row that does otherwise.
 */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i] ?? [];
    let hits = 0;
    for (let c = 1; c <= 12; c++) {
      const v = norm(cells[c] ?? "");
      if (v.startsWith(MONTHS[c - 1])) hits++;
    }
    if (hits === 12) return i;
  }
  return -1;
}

/** Which of the twelve header cells are not the month they should be. */
function headerDisorder(cells: string[]): string[] {
  const bad: string[] = [];
  for (let c = 1; c <= 12; c++) {
    const v = norm(cells[c] ?? "");
    if (!v.startsWith(MONTHS[c - 1])) {
      bad.push(`column ${c} should be ${MONTHS[c - 1]}, reads "${(cells[c] ?? "").trim()}"`);
    }
  }
  return bad;
}

/**
 * Table of cells -> channel rows + the sheet's own total row.
 *
 * Rows whose twelve month cells are not all numeric are skipped as labels, not
 * guessed at. The "Total sales by Channel" row is captured separately: it is a
 * total, not a channel, and it is the cheapest available proof that the A..M
 * column window is the right one.
 */
export function parseSheetTable(rows: string[][]): ParsedSheet {
  const headerRowIndex = findHeaderRow(rows);
  const channels: SheetChannelRow[] = [];
  let totalRow: number[] | null = null;

  const start = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const months: number[] = [];
    let ok = true;
    for (let c = 1; c <= 12; c++) {
      const raw = (cells[c] ?? "").trim().replace(/,/g, "").replace(/^฿/, "");
      if (raw === "") { months.push(0); continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) { ok = false; break; }
      months.push(n);
    }
    if (!ok) continue;                       // a label row, not a channel
    if (norm(name).startsWith(TOTAL_ROW_PREFIX)) { totalRow = months; continue; }
    channels.push({ name, months });
  }

  return { channels, totalRow, headerRowIndex };
}

export interface PortalChannel { id: string; channel: string }

export interface ValidationOutcome {
  ok: boolean;
  problems: SheetProblem[];
  /** sheet name -> portal channel, for the rows that matched. */
  matched: { row: SheetChannelRow; channel: PortalChannel }[];
  /** Cosmetic name differences that were accepted, e.g. "Line OA" -> "LINE OA". */
  renames: string[];
  summed: number;
  stated: number | null;
}

/**
 * Every check, in one place. Returns a verdict — it never throws and never
 * writes, so a caller can report the problems before deciding what to do.
 *
 * `portalChannels` must be the ACTIVE ONEST channels. Passing inactive ones
 * would let a retired channel satisfy the "every portal channel appears"
 * check and mask a real gap.
 */
export function validateSheet(
  parsed: ParsedSheet,
  portalChannels: PortalChannel[],
  rows: string[][],
): ValidationOutcome {
  const problems: SheetProblem[] = [];
  const matched: { row: SheetChannelRow; channel: PortalChannel }[] = [];
  const renames: string[] = [];

  // 1. The header must read Jan..Dec in order. Without it, nothing below can
  //    be trusted to be looking at the months it thinks it is.
  if (parsed.headerRowIndex < 0) {
    problems.push({
      code: "no_header",
      message: "No row in the first 20 reads Jan..Dec across columns B..M. The layout has changed; refusing to guess which columns are months.",
    });
  } else {
    const bad = headerDisorder(rows[parsed.headerRowIndex] ?? []);
    if (bad.length) {
      problems.push({ code: "header_out_of_order", message: `Month header is out of order: ${bad.join("; ")}.` });
    }
  }

  if (parsed.channels.length === 0) {
    problems.push({ code: "no_channels", message: "No channel rows found beneath the header." });
  }

  // 2. Every channel in the sheet must match an active portal channel.
  //    An unknown name refuses the whole run and names it — this is how
  //    "Loopers" was caught rather than silently dropped.
  const byName = new Map(portalChannels.map((c) => [norm(c.channel), c]));
  const seen = new Set<string>();
  for (const row of parsed.channels) {
    const hit = byName.get(norm(row.name));
    if (!hit) {
      problems.push({
        code: "unknown_channel",
        message: `Sheet channel "${row.name}" does not match any active portal channel. Add it in the portal, or correct the sheet — nothing is invented here.`,
      });
      continue;
    }
    seen.add(norm(hit.channel));
    if (row.name !== hit.channel) renames.push(`"${row.name}" -> "${hit.channel}"`);
    matched.push({ row, channel: hit });
  }

  // 3. Every active portal channel must appear in the sheet. The reverse of
  //    the check above, and the one that catches a channel SILENTLY DROPPED
  //    from the sheet — which would otherwise leave its old figures in place
  //    looking freshly synced.
  for (const c of portalChannels) {
    if (!seen.has(norm(c.channel))) {
      problems.push({
        code: "missing_channel",
        message: `Portal channel "${c.channel}" is active but absent from the sheet. Its figures would silently keep their previous values.`,
      });
    }
  }

  // 4. The channel rows must reproduce the sheet's own total.
  const summed = parsed.channels.reduce((s, c) => s + c.months.reduce((a, v) => a + v, 0), 0);
  const stated = parsed.totalRow ? parsed.totalRow.reduce((s, v) => s + v, 0) : null;
  if (stated === null) {
    problems.push({
      code: "no_total_row",
      message: 'No "Total sales by Channel" row found. That row is the only independent check that the A..M column window is right.',
    });
  } else if (Math.abs(summed - stated) >= 0.01) {
    problems.push({
      code: "total_mismatch",
      message: `Channel rows sum to ${summed.toFixed(2)} but the sheet's own total row reads ${stated.toFixed(2)} (difference ${(summed - stated).toFixed(2)}). The column window does not reproduce the sheet's total.`,
    });
  }

  return { ok: problems.length === 0, problems, matched, renames, summed, stated };
}

export interface ActualCell { channelId: string; month: number; actual: number | null }

export interface BuildResult {
  entries: ActualCell[];
  /** 1-based months written as NULL, and why. */
  nulledMonths: { month: number; reason: "future" | "all_zero" }[];
  genuineZeros: number;
  value: number;
}

/**
 * Turn validated rows into cells, applying BOTH null rules.
 *
 * ZERO IS NOT NULL, AND THE SHEET CANNOT TELL THEM APART. It writes 0.00 both
 * for "this month genuinely took nothing" and for "this month has not happened
 * yet / nobody has filled it in". Importing the second as 0 would assert the
 * business took no revenue in a month nobody has lived through, and every
 * percentage built on it would be a lie — the failure migration 040 exists to
 * prevent.
 *
 * Two independent signals say "not known", and a month is NULL if EITHER
 * fires. They are unioned rather than one replacing the other because they
 * catch different mistakes, and both point the same way — toward "unknown",
 * never toward asserting a figure that is not there:
 *
 *   FUTURE MONTH      -> NULL whatever the sheet says. Calendar-based, so it
 *                        holds even if someone types a forecast into December.
 *   WHOLE COLUMN 0.00 -> NULL, when every channel AND the total row read zero.
 *                        Data-based, so it catches a past month nobody has
 *                        filled in yet, which the calendar rule cannot see.
 *
 * The current month is imported as-is: real data for a part month. The report
 * already labels it "partial month" and suppresses its of-goal comparison.
 */
export function buildEntries(
  matched: { row: SheetChannelRow; channel: PortalChannel }[],
  totalRow: number[] | null,
  fiscalYear: number,
  now: Date,
): BuildResult {
  const curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
  const nulledMonths: { month: number; reason: "future" | "all_zero" }[] = [];

  const isFuture = (m: number) => fiscalYear > curYear || (fiscalYear === curYear && m > curMonth);
  const allZero = (m: number) =>
    matched.every((x) => x.row.months[m - 1] === 0) &&
    (totalRow === null || totalRow[m - 1] === 0);

  const nullMonth = new Set<number>();
  for (let m = 1; m <= 12; m++) {
    if (isFuture(m)) { nullMonth.add(m); nulledMonths.push({ month: m, reason: "future" }); }
    else if (matched.length > 0 && allZero(m)) { nullMonth.add(m); nulledMonths.push({ month: m, reason: "all_zero" }); }
  }

  const entries: ActualCell[] = [];
  let genuineZeros = 0, value = 0;
  for (const { row, channel } of matched) {
    for (let m = 1; m <= 12; m++) {
      if (nullMonth.has(m)) { entries.push({ channelId: channel.id, month: m, actual: null }); continue; }
      const v = row.months[m - 1];
      if (v === 0) genuineZeros++;
      value += v;
      entries.push({ channelId: channel.id, month: m, actual: v });
    }
  }

  return { entries, nulledMonths, genuineZeros, value };
}

/** The tab this reads, per fiscal year. Exact — a missing tab fails loudly. */
export const tabNameFor = (fiscalYear: number) => `SUMMARY REPORT ${fiscalYear}`;
