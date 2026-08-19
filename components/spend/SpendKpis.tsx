"use client";

import { EM_DASH, HEAT_OVER, elapsedFraction, pct, thb, thbSigned, utilisationColor } from "./format";
import type { SpendReport } from "@/lib/spend";

interface Props {
  report: SpendReport;
  fiscalYear: number;
}

// 3px coloured left border + 11px uppercase label + 26px value — the same
// stat-card treatment app/homeClient.tsx's Quick Stats already uses.
function Card({
  label,
  value,
  sub,
  accent,
  subColor,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  accent: string;
  subColor?: string;
}) {
  return (
    <div className="mm-card" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[11px] uppercase tracking-[0.05em] text-brand-subtle">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tabular-nums text-brand-dark">{value}</div>
      <div className="mt-1 text-[13px]" style={subColor ? { color: subColor } : undefined}>
        {sub}
      </div>
    </div>
  );
}

export default function SpendKpis({ report, fiscalYear }: Props) {
  const { budget, actual, pending, prevActual } = report.totals;

  const delta = actual - prevActual;
  const deltaPct = prevActual > 0 ? (delta / prevActual) * 100 : null;

  const remaining = budget - actual;
  const used = budget > 0 ? (actual / budget) * 100 : null;
  const projected = budget > 0 ? ((actual + pending) / budget) * 100 : null;
  const elapsed = elapsedFraction(fiscalYear, report.months) * 100;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Actual spend"
        value={thb(actual)}
        accent="#1F3A2B"
        sub={
          prevActual > 0 ? (
            <span style={{ color: delta > 0 ? HEAT_OVER : "#2E7D52" }}>
              {delta >= 0 ? "▲" : "▼"} {thbSigned(Math.abs(delta))}
              {deltaPct !== null && ` (${pct(Math.abs(deltaPct))})`} vs previous period
            </span>
          ) : (
            <span className="text-brand-subtle">No comparable previous period</span>
          )
        }
      />

      <Card
        label="Budget"
        value={budget > 0 ? thb(budget) : EM_DASH}
        accent="#BD5A2E"
        sub={
          budget > 0 ? (
            remaining >= 0 ? (
              <span className="text-brand-muted">{thb(remaining)} remaining</span>
            ) : (
              <span style={{ color: HEAT_OVER }}>{thb(Math.abs(remaining))} over</span>
            )
          ) : (
            <span className="text-brand-subtle">No budget set for this selection</span>
          )
        }
      />

      <Card
        label="Budget used"
        value={used === null ? EM_DASH : pct(used)}
        accent={used === null ? "#D8CBB0" : utilisationColor(used)}
        sub={
          used === null ? (
            <span className="text-brand-subtle">Needs a budget to measure against</span>
          ) : (
            // Pace, not just position — 61% used at 61% elapsed is on track.
            <span className="text-brand-muted">{pct(elapsed)} of the period elapsed</span>
          )
        }
      />

      <Card
        label="Pending approval"
        value={thb(pending)}
        accent="#9CAE8C"
        sub={
          projected === null ? (
            <span className="text-brand-subtle">
              {report.pending_requests.length} request
              {report.pending_requests.length === 1 ? "" : "s"} awaiting approval
            </span>
          ) : (
            <span className="text-brand-muted">
              {pct(projected)} projected used if all approved
            </span>
          )
        }
      />
    </div>
  );
}
