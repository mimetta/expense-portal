"use client";

import { MONTH_NAMES, QUARTERS, defaultPeriodFor } from "./format";
import type { SpendBasis, SpendGranularity } from "@/lib/spend";

export interface SpendFilterState {
  bu: string | null; // null = All
  granularity: SpendGranularity;
  period: number; // month 1-12 | quarter 1-4 | ignored for year
  year: number;
  basis: SpendBasis;
  department: string | null;
}

interface Props {
  value: SpendFilterState;
  years: number[];
  departments: string[];
  onChange: (next: Partial<SpendFilterState>) => void;
}

const BU_TABS: { label: string; value: string | null }[] = [
  { label: "SV", value: "SV" },
  { label: "ONEST", value: "ONEST" },
  { label: "All", value: null },
];

const GRANULARITIES: { label: string; value: SpendGranularity }[] = [
  { label: "Month", value: "month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
];

export default function SpendFilters({ value, years, departments, onChange }: Props) {
  return (
    <div className="mm-card">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div>
          <div className="mm-label mb-1">Business unit</div>
          <div className="mm-tabs">
            {BU_TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => onChange({ bu: tab.value })}
                className={`mm-tab ${value.bu === tab.value ? "mm-tab-active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mm-label mb-1">View by</div>
          <div className="mm-tabs">
            {GRANULARITIES.map((g) => (
              <button
                key={g.value}
                type="button"
                // The period index has to be reset when switching
                // granularity — 8 means August under Month but is out of
                // range for Quarter. Reset to the CURRENT month/quarter, not
                // to 1: hardcoding 1 here made Quarter land on Q1 and Month
                // land on January, and since the URL is rewritten from state
                // that stale January then persisted across refresh/share.
                onClick={() =>
                  onChange({ granularity: g.value, period: defaultPeriodFor(g.value) })
                }
                className={`mm-tab ${value.granularity === g.value ? "mm-tab-active" : ""}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mm-label mb-1 block">Year</span>
          <select
            className="mm-input w-[110px]"
            value={value.year}
            onChange={(e) => onChange({ year: Number(e.target.value) })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        {value.granularity !== "year" && (
          <label className="block">
            <span className="mm-label mb-1 block">
              {value.granularity === "month" ? "Month" : "Quarter"}
            </span>
            <select
              className="mm-input w-[150px]"
              value={value.period}
              onChange={(e) => onChange({ period: Number(e.target.value) })}
            >
              {value.granularity === "month"
                ? MONTH_NAMES.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))
                : QUARTERS.map((q, i) => (
                    <option key={q.label} value={i + 1}>
                      {q.label}
                    </option>
                  ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mm-label mb-1 block">Segment</span>
          <select
            className="mm-input w-[200px]"
            value={value.department ?? ""}
            onChange={(e) => onChange({ department: e.target.value || null })}
          >
            <option value="">All segments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="mm-label mb-1">Actual counts</div>
          <div className="mm-tabs">
            <button
              type="button"
              onClick={() => onChange({ basis: "approved" })}
              className={`mm-tab ${value.basis === "approved" ? "mm-tab-active" : ""}`}
              title="CEO approved and paid requests"
            >
              Approved
            </button>
            <button
              type="button"
              onClick={() => onChange({ basis: "paid" })}
              className={`mm-tab ${value.basis === "paid" ? "mm-tab-active" : ""}`}
              title="Paid requests only — money that has actually left the company"
            >
              Paid only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
