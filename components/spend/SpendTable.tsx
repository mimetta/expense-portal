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
  thbSigned,
  utilisationColor,
} from "./format";
import type { SpendGranularity, SpendNode, SpendReport } from "@/lib/spend";

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

// --- used bar --------------------------------------------------------------

function UsedCell({ node }: { node: SpendNode }) {
  const used = usedPct(node.total.actual, node.total.budget);
  if (used === null) {
    return <td className="px-3 py-2 text-right text-brand-subtle tabular-nums">{EM_DASH}</td>;
  }
  const color = utilisationColor(used);
  return (
    <td className="px-3 py-2 tabular-nums">
      <div className="flex items-center justify-end gap-2">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#F0EAE0]">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, used)}%`, background: color }}
          />
        </div>
        <span style={{ color }} className="w-11 text-right">
          {pct(used)}
        </span>
      </div>
    </td>
  );
}

// --- row -------------------------------------------------------------------

function Row({
  node,
  depth,
  months,
  showMonths,
  showPending,
  showVariance,
  fiscalYear,
  expanded,
  toggle,
}: {
  node: SpendNode;
  depth: number;
  months: number[];
  showMonths: boolean;
  showPending: boolean;
  showVariance: boolean;
  fiscalYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.key);
  const variance = node.total.budget - node.total.actual;

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

        <td className="px-3 py-2 text-right tabular-nums text-brand-muted">
          {node.total.budget > 0 ? thb(node.total.budget) : EM_DASH}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-brand-dark">
          {node.total.actual > 0 ? thb(node.total.actual) : EM_DASH}
        </td>
        {showPending && (
          <td className="px-3 py-2 text-right tabular-nums text-brand-muted">
            {node.total.pending > 0 ? thb(node.total.pending) : EM_DASH}
          </td>
        )}
        {showVariance && (
          <td
            className="px-3 py-2 text-right tabular-nums"
            style={{ color: variance < 0 ? HEAT_OVER : undefined }}
          >
            {node.total.budget > 0 ? thbSigned(variance) : EM_DASH}
          </td>
        )}
        <UsedCell node={node} />
      </tr>

      {isOpen &&
        node.children?.map((child) => (
          <Row
            key={child.key}
            node={child}
            depth={depth + 1}
            months={months}
            showMonths={showMonths}
            showPending={showPending}
            showVariance={showVariance}
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

  // Column layout per granularity:
  //   Month   -> Segment | Budget | Actual | Pending | Variance | Used
  //   Quarter -> Segment | <months> | Budget | Actual | Pending | Used
  //   Year    -> Segment | <months> | Budget | Actual | Used
  const showMonths = granularity !== "month";
  const showPending = granularity !== "year";
  const showVariance = granularity === "month";
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
  const footerVariance = footer.budget - footer.actual;
  const footerUsed = usedPct(footer.actual, footer.budget);

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
              <th className="text-right">Budget</th>
              <th className="text-right">Actual</th>
              {showPending && <th className="text-right">Pending</th>}
              {showVariance && <th className="text-right">Variance</th>}
              <th className="text-right">Used</th>
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
                showPending={showPending}
                showVariance={showVariance}
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
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-muted">
                {footer.budget > 0 ? thb(footer.budget) : EM_DASH}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-dark">
                {thb(footer.actual)}
              </td>
              {showPending && (
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-muted">
                  {footer.pending > 0 ? thb(footer.pending) : EM_DASH}
                </td>
              )}
              {showVariance && (
                <td
                  className="px-3 py-2 text-right font-semibold tabular-nums"
                  style={{ color: footerVariance < 0 ? HEAT_OVER : undefined }}
                >
                  {footer.budget > 0 ? thbSigned(footerVariance) : EM_DASH}
                </td>
              )}
              <td
                className="px-3 py-2 text-right font-semibold tabular-nums"
                style={footerUsed !== null ? { color: utilisationColor(footerUsed) } : undefined}
              >
                {footerUsed === null ? EM_DASH : pct(footerUsed)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
