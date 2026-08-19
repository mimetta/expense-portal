"use client";

import {
  EM_DASH,
  HEAT_NEAR,
  HEAT_OVER,
  HEAT_UNDER,
  MONTH_NAMES,
  compact,
  heatFor,
  isCurrentMonth,
  isFutureMonth,
  pct,
  thb,
  utilisationColor,
  varianceLabel,
} from "./format";
import type { SpendCell, SpendGranularity, SpendNode, SpendReport } from "@/lib/spend";

interface Props {
  report: SpendReport;
  granularity: SpendGranularity;
  fiscalYear: number;
  // Expansion state is owned by the page, not this component, so the CSV
  // export can emit exactly the rows that are currently on screen ("one row
  // per lowest expanded level").
  expanded: Set<string>;
  onToggle: (key: string) => void;
}

const CURRENT_MONTH_BG = "#F5F2EC";
const STICKY_W = 260;

function usedPct(actual: number, budget: number): number | null {
  return budget > 0 ? (actual / budget) * 100 : null;
}

// --- month cell ------------------------------------------------------------

function MonthCell({
  node,
  month,
  fiscalYear,
}: {
  node: SpendNode;
  month: number;
  fiscalYear: number;
}) {
  const cell = node.byMonth[month];
  const current = isCurrentMonth(fiscalYear, month);
  const base: React.CSSProperties = current ? { background: CURRENT_MONTH_BG } : {};

  // No data at all for this month, a future month, or a budgeted month with
  // nothing spent — all render as a muted em dash. A green "0%" in a budgeted
  // month reads as good news when it is actually no news.
  if (!cell || cell.actual === 0 || isFutureMonth(fiscalYear, month)) {
    return (
      <td className="px-2 py-2 text-right text-brand-subtle tabular-nums" style={base}>
        {EM_DASH}
      </td>
    );
  }

  const heat = heatFor(cell.actual, cell.budget);
  const style: React.CSSProperties = heat
    ? { ...base, background: heat.background, color: heat.color, fontWeight: 500 }
    : base;

  const title = heat
    ? `${MONTH_NAMES[month - 1]}: ${thb(cell.actual)} of ${thb(cell.budget)} (${pct(
        (cell.actual / cell.budget) * 100,
      )})`
    : `${MONTH_NAMES[month - 1]}: ${thb(cell.actual)} — no budget set`;

  return (
    <td className="px-2 py-2 text-right tabular-nums" style={style} title={title}>
      {compact(cell.actual)}
    </td>
  );
}

// --- metric block ----------------------------------------------------------
// The columns to the RIGHT of the per-month columns. Identical in all three
// granularities, so the block is the same shape whether or not month columns
// precede it.
//
// Declared as a list rather than hand-written <td>s so that adding a column
// later (e.g. % of revenue) is one entry here — header, every body row at
// every depth, and the footer all render from this array. Nothing below
// assumes a particular number of metric columns.

interface MetricColumn {
  key: string;
  label: string;
  /** `emphasis` is set for the sticky footer total row. */
  cell: (total: SpendCell, emphasis: boolean) => React.ReactNode;
}

function Money({ value, emphasis, muted }: { value: number; emphasis: boolean; muted?: boolean }) {
  return (
    <span
      className={`tabular-nums ${emphasis ? "font-semibold " : ""}${
        muted ? "text-brand-muted" : "text-brand-dark"
      }`}
    >
      {value > 0 ? thb(value) : EM_DASH}
    </span>
  );
}

/**
 * Actual, with variance and budget-utilisation collapsed underneath it as
 * small muted secondary text instead of two full-size columns of their own:
 *
 *     ฿1,562
 *     +38,000 · ▇▇▁ 91%
 *
 * Colour rules are unchanged from the standalone columns they replace:
 * negative variance in the over-budget red, utilisation on the same
 * <80 / 80-100 / >100 thresholds via utilisationColor().
 */
function ActualMetric({ total, emphasis }: { total: SpendCell; emphasis: boolean }) {
  const used = usedPct(total.actual, total.budget);
  const variance = total.budget - total.actual;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={`tabular-nums text-brand-dark ${emphasis ? "font-semibold" : ""}`}
      >
        {total.actual > 0 ? thb(total.actual) : EM_DASH}
      </span>
      {used === null ? (
        // No budget to measure against. A literal "+0 · 0%" here would read
        // as a real measurement of a perfectly-on-budget segment, which is
        // the opposite of the truth — one em dash says "not applicable".
        <span className="text-[11px] leading-none text-brand-subtle">{EM_DASH}</span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] leading-none">
          <span
            className="tabular-nums"
            style={{ color: variance < 0 ? HEAT_OVER : undefined }}
            title={variance < 0 ? "Over budget" : "Under budget"}
          >
            {varianceLabel(variance)}
          </span>
          <span className="text-brand-subtle">·</span>
          <span className="h-1 w-8 overflow-hidden rounded-full bg-[#F0EAE0]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, used)}%`, background: utilisationColor(used) }}
            />
          </span>
          <span className="tabular-nums" style={{ color: utilisationColor(used) }}>
            {pct(used)}
          </span>
        </span>
      )}
    </div>
  );
}

const METRIC_COLUMNS: MetricColumn[] = [
  {
    key: "budget",
    label: "Budget",
    cell: (t, emphasis) => <Money value={t.budget} emphasis={emphasis} muted />,
  },
  {
    key: "actual",
    label: "Actual",
    cell: (t, emphasis) => <ActualMetric total={t} emphasis={emphasis} />,
  },
  {
    key: "pending",
    label: "Pending",
    cell: (t, emphasis) => <Money value={t.pending} emphasis={emphasis} muted />,
  },
  // Next column (% of revenue) slots in here — no other change required.
];

// --- row -------------------------------------------------------------------

function Row({
  node,
  depth,
  months,
  showMonths,
  fiscalYear,
  expanded,
  toggle,
}: {
  node: SpendNode;
  depth: number;
  months: number[];
  showMonths: boolean;
  fiscalYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.key);

  return (
    <>
      <tr className={depth > 0 ? "bg-[#FCFBF9]" : undefined}>
        <th
          scope="row"
          className="sticky left-0 z-10 border-r border-brand-border px-3 py-2 text-left font-normal"
          style={{
            width: STICKY_W,
            minWidth: STICKY_W,
            background: depth > 0 ? "#FCFBF9" : "#FFFFFF",
            paddingLeft: 12 + depth * 18,
          }}
        >
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.key)}
                aria-expanded={isOpen}
                className="w-3.5 shrink-0 text-brand-subtle hover:text-brand-dark"
              >
                {isOpen ? "▾" : "▸"}
              </button>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span
              className={`truncate ${depth === 0 ? "font-medium text-brand-dark" : "text-brand-muted"}`}
              title={node.name}
            >
              {node.name}
            </span>
            {node.unbudgeted && (
              <span
                className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: "#FDF2EE", color: "#BD5A2E", border: "1px solid #F5C4A3" }}
              >
                no budget set
              </span>
            )}
          </div>
        </th>

        {showMonths &&
          months.map((m) => (
            <MonthCell key={m} node={node} month={m} fiscalYear={fiscalYear} />
          ))}

        {METRIC_COLUMNS.map((col) => (
          <td key={col.key} className="px-3 py-2 text-right align-top">
            {col.cell(node.total, false)}
          </td>
        ))}
      </tr>

      {isOpen &&
        node.children?.map((child) => (
          <Row
            key={child.key}
            node={child}
            depth={depth + 1}
            months={months}
            showMonths={showMonths}
            fiscalYear={fiscalYear}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
    </>
  );
}

// --- legend ----------------------------------------------------------------

function HeatLegend() {
  const items = [
    { color: HEAT_UNDER, label: "Under 80% of budget" },
    { color: HEAT_NEAR, label: "80–100%" },
    { color: HEAT_OVER, label: "Over budget" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-brand-muted">
      <span className="uppercase tracking-[0.05em] text-brand-subtle">Month shading</span>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-5 rounded-sm"
            style={{ background: `${item.color}1F`, border: `1px solid ${item.color}` }}
          />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-5 rounded-sm"
          style={{ background: CURRENT_MONTH_BG, border: "1px solid #D8CBB0" }}
        />
        Current month
      </span>
    </div>
  );
}

// --- table -----------------------------------------------------------------

export default function SpendTable({
  report,
  granularity,
  fiscalYear,
  expanded,
  onToggle,
}: Props) {
  const toggle = onToggle;

  // Column layout per granularity. The metric block (METRIC_COLUMNS) is now
  // IDENTICAL in all three; only whether per-month columns precede it varies:
  //   Month   -> Segment |            <metric block>
  //   Quarter -> Segment | <3 months> | <metric block>
  //   Year    -> Segment | <12 months>| <metric block>
  // Variance and Used are no longer columns — they are the secondary line
  // inside the Actual cell (see ActualMetric).
  const showMonths = granularity !== "month";
  const months = report.months;

  const footer = report.rows.reduce(
    (acc, row) => {
      acc.budget += row.total.budget;
      acc.actual += row.total.actual;
      acc.pending += row.total.pending;
      for (const m of months) {
        const cell = row.byMonth[m];
        if (!cell) continue;
        const f = acc.byMonth[m] ?? { budget: 0, actual: 0, pending: 0 };
        f.budget += cell.budget;
        f.actual += cell.actual;
        f.pending += cell.pending;
        acc.byMonth[m] = f;
      }
      return acc;
    },
    {
      budget: 0,
      actual: 0,
      pending: 0,
      byMonth: {} as Record<number, { budget: number; actual: number; pending: number }>,
    },
  );

  const footerNode: SpendNode = {
    key: "__total__",
    name: "Total",
    byMonth: footer.byMonth,
    total: { budget: footer.budget, actual: footer.actual, pending: footer.pending },
    unbudgeted: false,
  };

  if (report.rows.length === 0) {
    return (
      <div className="mm-card">
        <div className="mm-section-label">Spend by segment</div>
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-brand-dark">No spend in this selection</p>
          <p className="mt-1 text-[13px] text-brand-muted">
            Try widening the <strong>period</strong> or setting <strong>Segment</strong> back to
            &ldquo;All segments&rdquo;. If you are filtered to one business unit, switching to{" "}
            <strong>All</strong> may also help.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mm-card">
      <div className="mm-section-label">Spend by segment</div>

      {showMonths && (
        <div className="mb-3">
          <HeatLegend />
        </div>
      )}

      {/* The table scrolls horizontally in its own container; the segment
          column is position:sticky so the row label never scrolls away. The
          font is NOT reduced to make twelve month columns fit. */}
      <div className="mm-table-wrap overflow-x-auto">
        <table className="mm-table" style={{ minWidth: showMonths ? 1100 : 760 }}>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-20 border-r border-brand-border text-left"
                style={{ width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6" }}
              >
                Segment
              </th>
              {showMonths &&
                months.map((m) => (
                  <th
                    key={m}
                    className="text-right"
                    style={
                      isCurrentMonth(fiscalYear, m) ? { background: CURRENT_MONTH_BG } : undefined
                    }
                  >
                    {MONTH_NAMES[m - 1]}
                  </th>
                ))}
              {METRIC_COLUMNS.map((col) => (
                <th key={col.key} className="text-right">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <Row
                key={row.key}
                node={row}
                depth={0}
                months={months}
                showMonths={showMonths}
                fiscalYear={fiscalYear}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            <tr style={{ background: "#F9F8F6", borderTop: "1px solid #D8CBB0" }}>
              <th
                scope="row"
                className="sticky left-0 z-20 border-r border-brand-border px-3 py-2 text-left font-semibold text-brand-dark"
                style={{ width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6" }}
              >
                Total
              </th>
              {showMonths &&
                months.map((m) => {
                  const cell = footerNode.byMonth[m];
                  const future = isFutureMonth(fiscalYear, m);
                  return (
                    <td
                      key={m}
                      className="px-2 py-2 text-right font-semibold tabular-nums"
                      style={
                        isCurrentMonth(fiscalYear, m) ? { background: CURRENT_MONTH_BG } : undefined
                      }
                    >
                      {!cell || cell.actual === 0 || future ? (
                        <span className="font-normal text-brand-subtle">{EM_DASH}</span>
                      ) : (
                        compact(cell.actual)
                      )}
                    </td>
                  );
                })}
              {METRIC_COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2 text-right align-top">
                  {col.cell(footerNode.total, true)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
