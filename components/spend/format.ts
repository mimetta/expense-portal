// Formatting + heatmap helpers shared by the spend report components.
// Not UI components — no new shared UI primitive is introduced by this
// feature; everything visual reuses the existing .mm-* classes and brand
// tokens from app/globals.css / tailwind.config.ts.

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const QUARTERS: { label: string; months: number[] }[] = [
  { label: "Q1 (Jan–Mar)", months: [1, 2, 3] },
  { label: "Q2 (Apr–Jun)", months: [4, 5, 6] },
  { label: "Q3 (Jul–Sep)", months: [7, 8, 9] },
  { label: "Q4 (Oct–Dec)", months: [10, 11, 12] },
];

export const EM_DASH = "—";

/**
 * The period index to select for a granularity when the URL does not specify
 * one: current month (1-12), current quarter (1-4), or 1 for Year, where the
 * index is unused and the fiscal year alone identifies the window.
 *
 * Single source of truth on purpose. This used to be inlined in
 * spendClient.tsx#parseState (correct) *and* hardcoded to 1 in
 * SpendFilters' granularity buttons (wrong) — so a cold load defaulted to
 * the current month as intended, but clicking Quarter selected Q1 instead of
 * the current quarter, and clicking back to Month selected January. Worse,
 * the URL is rewritten on every state change, so that January stuck: the
 * shared link and any refresh then genuinely defaulted to Jan.
 */
export function defaultPeriodFor(
  granularity: "month" | "quarter" | "year",
  now = new Date(),
): number {
  if (granularity === "month") return now.getMonth() + 1;
  if (granularity === "quarter") return Math.floor(now.getMonth() / 3) + 1;
  return 1;
}

// THB, no decimals, thousands separators. Figures in this report are
// segment/period rollups where satang are noise.
export function thb(value: number): string {
  const rounded = Math.round(value);
  return `฿${rounded.toLocaleString("en-US")}`;
}

export function thbSigned(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}฿${Math.abs(rounded).toLocaleString("en-US")}`;
}

/**
 * Signed, no currency symbol — for the secondary line directly beneath an
 * Actual figure, where the ฿ on the line above already establishes the unit.
 * Unlike thbSigned() this shows an explicit "+" for a positive variance
 * (under budget), so the sign reads at a glance at 11px.
 */
export function varianceLabel(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US")}`;
}

// Compact form for the month cells — "226k", "1.4M". Twelve columns of full
// baht figures do not fit without shrinking the font, which the spec rules
// out explicitly.
export function compact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function pct(value: number): string {
  return `${Math.round(value)}%`;
}

// --- heatmap ---------------------------------------------------------------

export const HEAT_UNDER = "#2E7D52"; // < 80% of budget
export const HEAT_NEAR = "#C99A2E";  // 80–100%
export const HEAT_OVER = "#B23A2F";  // > 100%

export interface Heat {
  color: string;
  background: string;
}

/**
 * Utilisation tint for a month cell. Returns null when there is no budget to
 * measure against — an unbudgeted segment is called out by its own "no budget
 * set" chip and row position, so tinting it red as well would double-signal
 * the same fact and drown out genuine overspend inside budgeted segments.
 */
export function heatFor(actual: number, budget: number): Heat | null {
  if (budget <= 0) return null;
  const used = (actual / budget) * 100;
  const color = used > 100 ? HEAT_OVER : used >= 80 ? HEAT_NEAR : HEAT_UNDER;
  // Low-alpha fill of the same hue — a tint, not a solid block, so the
  // figure itself stays the thing you read.
  return { color, background: `${color}1F` };
}

export function utilisationColor(used: number): string {
  return used > 100 ? HEAT_OVER : used >= 80 ? HEAT_NEAR : HEAT_UNDER;
}

// --- period helpers --------------------------------------------------------

/**
 * Months that have not happened yet, for the selected fiscal year. A future
 * month must render an em dash, never a zero — a 0 in a budgeted month reads
 * as "spent nothing", which is false news rather than no news.
 */
export function isFutureMonth(fiscalYear: number, month: number, now = new Date()): boolean {
  if (fiscalYear > now.getFullYear()) return true;
  if (fiscalYear < now.getFullYear()) return false;
  return month > now.getMonth() + 1;
}

export function isCurrentMonth(fiscalYear: number, month: number, now = new Date()): boolean {
  return fiscalYear === now.getFullYear() && month === now.getMonth() + 1;
}

/**
 * How much of the selected window has actually elapsed, 0–1. Makes pace
 * legible: mid-August in a Jul–Sep view is ~61% elapsed, so 61% of budget
 * used is on track, not alarming.
 */
export function elapsedFraction(fiscalYear: number, months: number[], now = new Date()): number {
  if (months.length === 0) return 0;
  let elapsedDays = 0;
  let totalDays = 0;
  for (const m of months) {
    const daysInMonth = new Date(fiscalYear, m, 0).getDate();
    totalDays += daysInMonth;
    if (isFutureMonth(fiscalYear, m, now)) continue;
    elapsedDays += isCurrentMonth(fiscalYear, m, now) ? now.getDate() : daysInMonth;
  }
  return totalDays === 0 ? 0 : Math.min(1, elapsedDays / totalDays);
}
