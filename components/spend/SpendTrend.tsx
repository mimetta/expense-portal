"use client";

import { MONTH_NAMES, compact, isCurrentMonth, thb } from "./format";
import type { SpendReport } from "@/lib/spend";

interface Props {
  report: SpendReport;
  fiscalYear: number;
}

// Plain inline SVG. This repo has no charting library (package.json has none)
// and the spec rules out adding a dependency for one chart.
const W = 960;
const H = 220;
const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

export default function SpendTrend({ report, fiscalYear }: Props) {
  const data = report.trend;
  const max = Math.max(
    1,
    ...data.map((d) => d.actual + d.pending),
    ...data.map((d) => d.budget),
  );

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / 12;
  const barW = Math.min(30, slot * 0.55);

  const y = (value: number) => PAD_T + plotH - (value / max) * plotH;
  const xCenter = (i: number) => PAD_L + slot * i + slot / 2;

  const budgetPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i).toFixed(1)} ${y(d.budget).toFixed(1)}`)
    .join(" ");

  const hasBudget = data.some((d) => d.budget > 0);

  // Four gridlines is enough to read the shape without competing with the bars.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="mm-card">
      <div className="mm-section-label">12-month trend</div>
      <p className="-mt-2 mb-3 text-[13px] text-brand-muted">
        Always the full year, whatever period is selected above — the table is for finding a
        number, this is for seeing the shape.
      </p>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[220px] w-full min-w-[720px]"
          role="img"
          aria-label={`Monthly actual and pending spend for ${fiscalYear}`}
        >
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(t)}
                y2={y(t)}
                stroke="#F0EAE0"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y(t) + 3}
                textAnchor="end"
                className="tabular-nums"
                fontSize={10}
                fill="#9CA3AF"
              >
                {compact(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const current = isCurrentMonth(fiscalYear, d.month);
            const x = xCenter(i) - barW / 2;
            const actualH = (d.actual / max) * plotH;
            const pendingH = (d.pending / max) * plotH;
            return (
              <g key={d.month}>
                {current && (
                  <rect
                    x={PAD_L + slot * i}
                    y={PAD_T}
                    width={slot}
                    height={plotH}
                    fill="#F5F2EC"
                  />
                )}
                {/* Stacked: actual at the base, pending on top of it. */}
                <rect
                  x={x}
                  y={y(d.actual)}
                  width={barW}
                  height={Math.max(0, actualH)}
                  fill="#1F3A2B"
                  rx={2}
                >
                  <title>{`${MONTH_NAMES[d.month - 1]} actual: ${thb(d.actual)}`}</title>
                </rect>
                <rect
                  x={x}
                  y={y(d.actual + d.pending)}
                  width={barW}
                  height={Math.max(0, pendingH)}
                  fill="#9CAE8C"
                  rx={2}
                >
                  <title>{`${MONTH_NAMES[d.month - 1]} pending: ${thb(d.pending)}`}</title>
                </rect>
                <text
                  x={xCenter(i)}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize={10}
                  fill={current ? "#1A1A1A" : "#9CA3AF"}
                  fontWeight={current ? 600 : 400}
                >
                  {MONTH_NAMES[d.month - 1]}
                </text>
              </g>
            );
          })}

          {hasBudget && (
            <path
              d={budgetPath}
              fill="none"
              stroke="#BD5A2E"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          )}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-brand-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#1F3A2B" }} />
          Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#9CAE8C" }} />
          Pending
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={22} height={4} aria-hidden>
            <line
              x1={0}
              y1={2}
              x2={22}
              y2={2}
              stroke="#BD5A2E"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          </svg>
          Budget
        </span>
      </div>
    </div>
  );
}
