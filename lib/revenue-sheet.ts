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

/**
 * Sheet names that norm() cannot reconcile with the portal's, keyed on the
 * NORMALISED sheet name.
 *
 * norm() absorbs case, spacing and punctuation. It deliberately does NOT
 * absorb abbreviations or plurals: a fuzzy matcher here would silently bind
 * the wrong channel to real money, and the whole point of the unknown-channel
 * check is that a name it does not recognise stops the run.
 *
 * So the exceptions are DECLARED, one line each, with the reason. Keep this
 * map small and keep the comments — it is also the one place where a typo can
 * be legitimised into a match.
 */
const SHEET_ALIASES: Record<string, string> = {
  // The sheet writes the plural "Unusual&Friends"; the portal channel is
  // singular. One trailing character apart, which norm() leaves distinct.
  unusualfriends: "Unusual & Friend",
};

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

export interface SheetChannelRow {
  name: string;
  /**
   * Twelve values, Jan..Dec.
   *
   * null = the cell was BLANK, which means "not known". 0 = the cell held a
   * genuine zero. The sheet cannot currently express the difference — every
   * cell in it is a formula result, so none is ever blank — but this is the
   * mapping the moment it can, and a prerequisite for making that change.
   */
  months: (number | null)[];
}

export interface ParsedSheet {
  channels: SheetChannelRow[];
  /** The sheet's own "Total sales by Channel" row, Jan..Dec, or null if absent. */
  totalRow: (number | null)[] | null;
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
  let totalRow: (number | null)[] | null = null;

  const start = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const months: (number | null)[] = [];
    let ok = true;
    for (let c = 1; c <= 12; c++) {
      const raw = (cells[c] ?? "").trim().replace(/,/g, "").replace(/^฿/, "");
      // A BLANK CELL IS NOT A ZERO. It read as 0 until now, which made a
      // partner that posts late indistinguishable from one that sold nothing.
      // null carries "not known" through to the import, where it becomes a
      // NULL actual rather than an asserted zero — see migration 040 for why
      // that distinction is worth this much care.
      if (raw === "") { months.push(null); continue; }
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

export interface PortalChannel {
  id: string;
  channel: string;
  /** Closed channels are exempt from the "must appear in the sheet" check. */
  closed?: boolean;
}

export interface ValidationOutcome {
  /** True when nothing REFUSES the run. Warnings do not clear this flag. */
  ok: boolean;
  /** Refuse the whole run. The sheet is wrong and a person must fix it. */
  problems: SheetProblem[];
  /**
   * Proceed, but say so loudly. The sheet is probably just behind the portal.
   */
  warnings: SheetProblem[];
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
  const warnings: SheetProblem[] = [];
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
    const key = norm(row.name);
    const aliased = SHEET_ALIASES[key];
    const hit = byName.get(key) ?? (aliased ? byName.get(norm(aliased)) : undefined);
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

  // 3. A portal channel absent from the sheet is a WARNING, not a refusal.
  //
  // ===========================================================================
  // WHY THIS CASE DIFFERS FROM THE ONE ABOVE.
  // ===========================================================================
  // An unmatched SHEET row means THE SHEET IS WRONG — a typo, or a channel
  // somebody invented in the spreadsheet. Importing it would mean inventing a
  // revenue stream in the portal from a misspelling, so that still refuses the
  // whole run.
  //
  // An unmatched PORTAL channel usually means THE SHEET HAS NOT CAUGHT UP YET.
  // Somebody added a branch in the portal this morning and the sheet gains its
  // row tomorrow. Refusing everything for that stopped ALL revenue actuals
  // updating — including every channel that matched perfectly — and the person
  // who added the channel had no way to know they had done it.
  //
  // So: import what matched, leave the unmatched channel's figures exactly as
  // they were, and report it loudly. The risk this accepts is the one the
  // message names — a channel silently DROPPED from the sheet keeps its old
  // figures while looking freshly synced — which is why it is surfaced in the
  // run summary, the budget page banner and Discord rather than only here.
  for (const c of portalChannels) {
    // A CLOSED channel is exempt. It keeps its history and is still importable
    // while the sheet lists it, but the sheet will eventually stop carrying a
    // closed partner — and if that failed validation, closing a channel would
    // break the daily sync permanently and nothing could be imported at all.
    if (c.closed) continue;
    if (!seen.has(norm(c.channel))) {
      warnings.push({
        code: "missing_channel",
        message: `Portal channel "${c.channel}" is not in the sheet — its figures were left unchanged. Add a row for it to the sheet, or close the channel if it has retired.`,
      });
    }
  }

  // 4. The channel rows must reproduce the sheet's own total.
  // A BLANK CONTRIBUTES NOTHING TO THE SUM, and must not break the check: it
  // is an unknown, not a figure that went missing. Only real numbers are
  // added, on both sides, so a sheet with blanks still reconciles against its
  // own total row exactly as one without them does.
  const addKnown = (a: number, v: number | null) => (v === null ? a : a + v);
  const summed = parsed.channels.reduce((s, c) => s + c.months.reduce(addKnown, 0), 0);
  const stated = parsed.totalRow ? parsed.totalRow.reduce(addKnown, 0) : null;
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

  // Warnings deliberately do NOT clear `ok`: they are things to tell somebody
  // about, not reasons to withhold figures that are perfectly good.
  return { ok: problems.length === 0, problems, warnings, matched, renames, summed, stated };
}

export interface ActualCell { channelId: string; month: number; actual: number | null }

export interface BuildResult {
  entries: ActualCell[];
  /** 1-based months written as NULL, and why. */
  nulledMonths: { month: number; reason: "future" | "all_zero" }[];
  genuineZeros: number;
  /** Cells that were blank in the sheet and imported as NULL, not zero. */
  blankCells: number;
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
  totalRow: (number | null)[] | null,
  fiscalYear: number,
  now: Date,
): BuildResult {
  const curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
  const nulledMonths: { month: number; reason: "future" | "all_zero" }[] = [];
  let blankCells = 0;

  const isFuture = (m: number) => fiscalYear > curYear || (fiscalYear === curYear && m > curMonth);
  // Strictly 0, never null: a column of BLANKS is not "every channel read
  // zero". Each blank is already null in its own right, so the whole-column
  // rule has nothing to add there — and treating blank as zero here would
  // reintroduce, for the column rule, exactly the conflation the per-cell
  // change removes.
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
      // THE THIRD WAY A MONTH BECOMES NULL, and the only per-CELL one: this
      // channel's cell was blank while others in the same month had figures.
      // That is precisely the late-posting partner the column rule cannot see.
      if (v === null) { blankCells++; entries.push({ channelId: channel.id, month: m, actual: null }); continue; }
      if (v === 0) genuineZeros++;
      value += v;
      entries.push({ channelId: channel.id, month: m, actual: v });
    }
  }

  return { entries, nulledMonths, genuineZeros, value, blankCells };
}

/** The tab this reads, per fiscal year. Exact — a missing tab fails loudly. */
export const tabNameFor = (fiscalYear: number) => `SUMMARY REPORT ${fiscalYear}`;
