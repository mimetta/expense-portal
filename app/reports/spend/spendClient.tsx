"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SpendFilters, { type SpendFilterState } from "@/components/spend/SpendFilters";
import SpendKpis from "@/components/spend/SpendKpis";
import SpendTable from "@/components/spend/SpendTable";
import SpendTrend from "@/components/spend/SpendTrend";
import PendingPanel from "@/components/spend/PendingPanel";
import { MONTH_NAMES, QUARTERS, defaultPeriodFor } from "@/components/spend/format";
import { ALL_MONTHS, type SpendGranularity, type SpendNode, type SpendReport } from "@/lib/spend";
import { BUSINESS_UNITS } from "@/lib/constants";

// --- URL <-> state ---------------------------------------------------------
// Every filter lives in the query string so a view is shareable and survives
// a refresh. Written with history.replaceState rather than router.push for
// the same reason app/settings/settingsClient.tsx does: a router navigation
// would re-run the server component's auth guard on every filter click, a
// full round trip for something only the address bar needs to know.

function parseState(params: URLSearchParams, currentYear: number): SpendFilterState {
  const buParam = params.get("bu");
  const granParam = params.get("gran");
  const granularity: SpendGranularity =
    granParam === "month" || granParam === "quarter" || granParam === "year" ? granParam : "month";
  const periodRaw = Number(params.get("period"));
  const maxPeriod = granularity === "month" ? 12 : granularity === "quarter" ? 4 : 1;
  const yearRaw = Number(params.get("year"));

  return {
    bu: buParam && (BUSINESS_UNITS as readonly string[]).includes(buParam) ? buParam : null,
    granularity,
    // An explicit, in-range ?period= always wins; otherwise fall back to the
    // current month/quarter for the granularity in play.
    period:
      Number.isInteger(periodRaw) && periodRaw >= 1 && periodRaw <= maxPeriod
        ? periodRaw
        : defaultPeriodFor(granularity),
    year: Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : currentYear,
    basis: params.get("basis") === "paid" ? "paid" : "approved",
    department: params.get("segment") || null,
  };
}

function toQuery(state: SpendFilterState): string {
  const params = new URLSearchParams();
  if (state.bu) params.set("bu", state.bu);
  params.set("gran", state.granularity);
  if (state.granularity !== "year") params.set("period", String(state.period));
  params.set("year", String(state.year));
  params.set("basis", state.basis);
  if (state.department) params.set("segment", state.department);
  return params.toString();
}

function monthsFor(state: SpendFilterState): number[] {
  if (state.granularity === "year") return ALL_MONTHS;
  if (state.granularity === "quarter") return QUARTERS[state.period - 1].months;
  return [state.period];
}

function periodLabel(state: SpendFilterState): string {
  if (state.granularity === "year") return String(state.year);
  if (state.granularity === "quarter") return `${state.year}-Q${state.period}`;
  return `${state.year}-${String(state.period).padStart(2, "0")}`;
}

// --- CSV -------------------------------------------------------------------

/** The leaves of the currently-visible tree — the "lowest expanded level". */
function visibleLeaves(
  nodes: SpendNode[],
  expanded: Set<string>,
  trail: string[] = [],
): { path: string[]; node: SpendNode }[] {
  const out: { path: string[]; node: SpendNode }[] = [];
  for (const node of nodes) {
    const path = [...trail, node.name];
    if (expanded.has(node.key) && node.children?.length) {
      out.push(...visibleLeaves(node.children, expanded, path));
    } else {
      out.push({ path, node });
    }
  }
  return out;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(report: SpendReport, expanded: Set<string>): string {
  const header = [
    "Segment",
    "Category L1",
    "Category L2",
    ...report.months.flatMap((m) => [`${MONTH_NAMES[m - 1]} Budget`, `${MONTH_NAMES[m - 1]} Actual`]),
    "Budget",
    "Actual",
    "Pending",
    "Variance",
    "Used %",
  ];

  const rows = visibleLeaves(report.rows, expanded).map(({ path, node }) => {
    const used = node.total.budget > 0 ? (node.total.actual / node.total.budget) * 100 : null;
    return [
      path[0] ?? "",
      path[1] ?? "",
      path[2] ?? "",
      ...report.months.flatMap<string | number>((m) => {
        const cell = node.byMonth[m];
        // Blank, not 0 — a month with no data must not read as zero spend
        // once the numbers leave the UI that renders an em dash for it.
        return cell ? [cell.budget, cell.actual] : ["", ""];
      }),
      node.total.budget,
      node.total.actual,
      node.total.pending,
      node.total.budget - node.total.actual,
      used === null ? "" : Math.round(used),
    ];
  });

  const totalRow = [
    "Total",
    "",
    "",
    ...report.months.flatMap<string | number>((m) => {
      const sums = report.rows.reduce(
        (acc, r) => {
          const cell = r.byMonth[m];
          if (cell) {
            acc.budget += cell.budget;
            acc.actual += cell.actual;
            acc.any = true;
          }
          return acc;
        },
        { budget: 0, actual: 0, any: false },
      );
      return sums.any ? [sums.budget, sums.actual] : ["", ""];
    }),
    report.totals.budget,
    report.totals.actual,
    report.totals.pending,
    report.totals.budget - report.totals.actual,
    report.totals.budget > 0
      ? Math.round((report.totals.actual / report.totals.budget) * 100)
      : "",
  ];

  return [header, ...rows, totalRow].map((r) => r.map(csvCell).join(",")).join("\n");
}

// --- skeleton --------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mm-card">
            <div className="h-3 w-24 animate-pulse rounded bg-[#F0EAE0]" />
            <div className="mt-3 h-7 w-32 animate-pulse rounded bg-[#F0EAE0]" />
            <div className="mt-2 h-3 w-40 animate-pulse rounded bg-[#F5F0E8]" />
          </div>
        ))}
      </div>
      <div className="mm-card">
        <div className="h-3 w-32 animate-pulse rounded bg-[#F0EAE0]" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-[#F9F8F6]" />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- page ------------------------------------------------------------------

export default function SpendReportClient() {
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();

  const [state, setState] = useState<SpendFilterState>(() =>
    parseState(new URLSearchParams(searchParams.toString()), currentYear),
  );
  const [report, setReport] = useState<SpendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const months = useMemo(() => monthsFor(state), [state]);

  // Mirror state into the address bar without a Next.js navigation.
  useEffect(() => {
    const query = toQuery(state);
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      year: String(state.year),
      months: months.join(","),
      basis: state.basis,
    });
    if (state.bu) params.set("bu", state.bu);
    if (state.department) params.set("department", state.department);

    fetch(`/api/spend-report?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load spend report");
        return body as SpendReport;
      })
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state.year, state.bu, state.basis, state.department, months]);

  const onChange = useCallback((next: Partial<SpendFilterState>) => {
    setState((prev) => ({ ...prev, ...next }));
    // Row keys are department-scoped; a different filter set is a different
    // set of rows, so stale expansion state would be meaningless.
    setExpanded(new Set());
  }, []);

  const onToggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const departments = useMemo(() => {
    if (!report) return [];
    return report.rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  }, [report]);

  const exportCsv = () => {
    if (!report) return;
    const csv = buildCsv(report, expanded);
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spend-report_${state.bu ?? "all"}_${periodLabel(state)}_${state.basis}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const heading =
    state.granularity === "year"
      ? String(state.year)
      : state.granularity === "quarter"
        ? `${QUARTERS[state.period - 1].label.split(" ")[0]} ${state.year}`
        : `${MONTH_NAMES[state.period - 1]} ${state.year}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mm-page-title">Spend report</h1>
          <p className="mm-page-subtitle">
            Spend vs budget by segment — {heading}
            {state.bu ? ` · ${state.bu}` : " · all business units"} ·{" "}
            {state.basis === "paid" ? "paid only" : "approved + paid"}
          </p>
        </div>
        <button
          type="button"
          className="mm-btn-secondary"
          onClick={exportCsv}
          disabled={!report || report.rows.length === 0}
        >
          Export CSV
        </button>
      </div>

      <SpendFilters
        value={state}
        years={[currentYear + 1, currentYear, currentYear - 1, currentYear - 2]}
        departments={departments}
        onChange={onChange}
      />

      {error && (
        <div
          className="rounded-[10px] px-4 py-3 text-sm"
          style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" }}
        >
          {error}
        </div>
      )}

      {loading && <Skeleton />}

      {!loading && !error && report && (
        <>
          <SpendKpis report={report} fiscalYear={state.year} />
          <SpendTable
            report={report}
            granularity={state.granularity}
            fiscalYear={state.year}
            expanded={expanded}
            onToggle={onToggle}
          />
          <SpendTrend report={report} fiscalYear={state.year} />
          <PendingPanel requests={report.pending_requests} />
        </>
      )}
    </div>
  );
}
