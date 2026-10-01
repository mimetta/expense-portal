"use client";

import { EM_DASH, thb, budgetToDate } from "@/components/spend/format";

// The cell designs from docs/revenue-actual-mockup.html, in one place so the
// budget page and the spend report cannot drift apart. The mockup's own hex
// values and type sizes are used verbatim rather than approximated.
//
// THE RULE THAT GOVERNS ALL OF THEM: null is not zero. A null actual means
// "not yet known" and renders as an em dash. It is never coerced to 0, and a
// percentage built on it is not shown at all rather than shown as 0% — see
// migration 040.

const INK = "#1B1B18";
const MUTED = "#6B6B60";
const LABEL = "#A9A497";
const NONE = "#C0BBAE";
const UP = "#1E5537";
const DOWN = "#8E2A21";

/** Tint bands, matching the mockup's band(): >100 over, >=80 warn, else ok. */
export const BANDS = {
  ok: { background: "rgba(46,125,82,.10)", color: "#1E5537", fontWeight: 400 },
  warn: { background: "rgba(201,154,46,.14)", color: "#7A5A0F", fontWeight: 400 },
  over: { background: "rgba(178,58,47,.12)", color: "#8E2A21", fontWeight: 500 },
  none: { background: "transparent", color: NONE, fontWeight: 400 },
} as const;

export function bandFor(usedPct: number | null) {
  if (usedPct === null || !Number.isFinite(usedPct)) return BANDS.none;
  if (usedPct > 100) return BANDS.over;
  if (usedPct >= 80) return BANDS.warn;
  return BANDS.ok;
}

/** 8px uppercase key + value, the mockup's .kv row. */
function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-[7px] leading-[1.3]">
      <span
        className="flex-none uppercase"
        style={{ fontSize: 8, letterSpacing: "0.06em", color: LABEL, fontWeight: 400 }}
      >
        {k}
      </span>
      {children}
    </div>
  );
}

/** The mockup's .pcrow — a small labelled percentage under the figures. */
function PcRow({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <div
      className="flex justify-between gap-[7px]"
      style={{
        marginTop: first ? 2 : 0,
        paddingTop: first ? 2 : 0,
        borderTop: first ? "1px solid rgba(0,0,0,.06)" : "none",
      }}
    >
      <span className="uppercase" style={{ fontSize: 8, letterSpacing: "0.06em", color: LABEL }}>
        {k}
      </span>
      <span className="tabular-nums" style={{ fontSize: 10.5, color: MUTED, fontWeight: 400 }}>
        {v}
      </span>
    </div>
  );
}

/**
 * Revenue: goal above, actual below. Used on the budget page's revenue rows
 * and as the spend report's "Revenue actual" row.
 *
 * The actual is green above goal and red below — but only when there IS a
 * goal to compare against. With no goal, comparing would be meaningless, so
 * it stays neutral rather than defaulting to "below".
 */
export function GoalActualCell({
  goal,
  actual,
  partial,
  goalToDate,
}: {
  goal: number | null;
  actual: number | null;
  /** Current month: the comparison is unfair, so "of goal" is suppressed. */
  partial?: boolean;
  /**
   * The goal covering ONLY the months the actual actually covers. Set on a
   * year-total cell, where the actual is year-to-date but the goal is the
   * whole year: dividing one by the other would report a complete year's
   * underperformance when all that happened is the year is not over. When it
   * differs from `goal` the percentage divides by THIS and says "to date", so
   * the figure above and the figure it is divided by are never silently
   * different things. Omit it on a month cell, where the two coincide.
   */
  goalToDate?: number | null;
}) {
  const known = actual !== null;
  // Undefined means "no separate basis given" — a month cell. Null means a
  // basis was computed and there is none, which is not the same thing.
  const basis = goalToDate === undefined ? goal : goalToDate;
  const comparable = known && basis !== null && basis > 0;
  const toDate = goalToDate !== undefined && goalToDate !== goal;
  const color = !known ? NONE : comparable ? (actual >= basis! ? UP : DOWN) : INK;
  return (
    <>
      <Kv k="Goal">
        <span className="tabular-nums" style={{ fontSize: 10.5, color: MUTED, fontWeight: 400 }}>
          {goal === null ? EM_DASH : thb(goal)}
        </span>
      </Kv>
      <Kv k="Actual">
        <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color }}>
          {known ? thb(actual!) : EM_DASH}
        </span>
      </Kv>
      {comparable && (
        <PcRow
          first
          k={partial ? "partial month" : toDate ? "of goal to date" : "of goal"}
          v={partial ? EM_DASH : `${Math.round((actual! / basis!) * 100)}%`}
        />
      )}
    </>
  );
}

/**
 * The full labelled spend cell — Budget / Actual / used % / of rev %.
 * Segment rows and the footer use this at every level.
 *
 * `revenueActual` is the month's ACTUAL revenue. When it is null the "of rev"
 * line shows an em dash rather than falling back to the goal: the two are
 * different facts and must never be silently mixed.
 */
export function FullSpendCell({
  budget,
  actual,
  revenueActual,
}: {
  budget: number;
  actual: number;
  revenueActual: number | null;
}) {
  const used = budget > 0 ? (actual / budget) * 100 : null;
  const ofRev = revenueActual !== null && revenueActual > 0 ? (actual / revenueActual) * 100 : null;
  return (
    <>
      <Kv k="Budget">
        <span className="tabular-nums" style={{ fontSize: 10.5, color: MUTED, fontWeight: 400 }}>
          {thb(budget)}
        </span>
      </Kv>
      <Kv k="Actual">
        <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: INK }}>
          {thb(actual)}
        </span>
      </Kv>
      <PcRow first k="used" v={used === null ? EM_DASH : `${Math.round(used)}%`} />
      <PcRow k="of rev" v={ofRev === null ? EM_DASH : `${ofRev.toFixed(1)}%`} />
    </>
  );
}

/**
 * The "Simpler deeper down" cell, used on cat_l1 and cat_l2 rows: the actual
 * in bold with "86% of 260,000" beneath. Same tint as the full cell, so the
 * colour scan works unbroken down the drill.
 */
export function SimpleSpendCell({ budget, actual }: { budget: number; actual: number }) {
  const used = budget > 0 ? (actual / budget) * 100 : null;
  return (
    <>
      <span className="block tabular-nums" style={{ fontSize: 13, fontWeight: 700 }}>
        {thb(actual)}
      </span>
      <span className="block tabular-nums" style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>
        {used === null ? `no budget` : `${Math.round(used)}% of ${thb(budget)}`}
      </span>
    </>
  );
}

/** Pro-rated budget for a month, reusing the report's existing helper. */
export const monthBudget = (budget: number, fiscalYear: number, month: number) =>
  budgetToDate(budget, fiscalYear, month);
