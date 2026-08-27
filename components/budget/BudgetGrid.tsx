"use client";

import { useCallback, useMemo, useRef } from "react";
import { MONTH_NAMES, thb, EM_DASH } from "@/components/spend/format";
import type { EditorRow } from "@/lib/budget-editor";

// The editable budget grid. A BO like siriwan.b holds ~50 lines x 12 months =
// 600 cells, so the four entry interactions below are the feature, not polish:
// without them nobody keeps a budget current.
//
//   paste       12 tab/comma/semicolon-separated values fill rightward
//   arrows      up/down always; left/right at the ends of the text
//   fill-right  one cell's value to December
//   copy-actual last year's actual into the whole row
//
// Cells differing from the currently-approved figure are highlighted.

const OVER = "#B23A2F";
const UNDER = "#2E7D52";
const CHANGED_BG = "rgba(189, 90, 46, 0.10)";
const CHANGED_BORDER = "#BD5A2E";
const STICKY_W = 300;

export interface GridProps {
  rows: EditorRow[];
  /** null = read-only (CEO review). */
  onChange: ((rowKey: string, month: number, value: number) => void) | null;
  onFillRight?: (rowKey: string, fromMonth: number) => void;
  onCopyPriorYear?: (rowKey: string) => void;
  onClearRow?: (rowKey: string) => void;
  /** CEO review adds a per-row Change column and the delta beneath each cell. */
  showDelta?: boolean;
  priorFiscalYear?: number;
}

interface Grouped {
  deptHead?: string;
  l1Head?: string;
  row?: EditorRow;
  index?: number;
}

/** dept → cat_l1 → cat_l2, with heading rows, matching the mockup. */
function group(rows: EditorRow[]): Grouped[] {
  const out: Grouped[] = [];
  let dept: string | null = null;
  let l1: string | null = null;
  rows.forEach((r, i) => {
    if (r.department !== dept) {
      out.push({ deptHead: r.department });
      dept = r.department;
      l1 = null;
    }
    if (r.cat_l1 !== l1) {
      out.push({ l1Head: r.cat_l1 });
      l1 = r.cat_l1;
    }
    out.push({ row: r, index: i });
  });
  return out;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const parseNum = (s: string) => {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export default function BudgetGrid({
  rows,
  onChange,
  onFillRight,
  onCopyPriorYear,
  onClearRow,
  showDelta = false,
  priorFiscalYear,
}: GridProps) {
  const gridRef = useRef<HTMLTableElement>(null);
  const readOnly = onChange === null;
  const grouped = useMemo(() => group(rows), [rows]);

  const focusCell = useCallback((rowIdx: number, month: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-r="${rowIdx}"][data-m="${month}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, month: number) => {
      const el = e.currentTarget;
      let target: [number, number] | null = null;
      // Left/right only jump at the text ends, so arrowing WITHIN a number
      // still works normally — otherwise editing a figure becomes impossible.
      if (e.key === "ArrowRight" && el.selectionStart === el.value.length) target = [rowIdx, month + 1];
      if (e.key === "ArrowLeft" && el.selectionStart === 0) target = [rowIdx, month - 1];
      if (e.key === "ArrowDown") target = [rowIdx + 1, month];
      if (e.key === "ArrowUp") target = [rowIdx - 1, month];
      if (e.key === "Enter") target = [rowIdx + 1, month];
      if (target) {
        e.preventDefault();
        focusCell(target[0], Math.max(0, Math.min(11, target[1])));
      }
    },
    [focusCell],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, row: EditorRow, month: number) => {
      const text = e.clipboardData.getData("text");
      // Tab, comma, semicolon, newline, or 2+ spaces — covers Sheets, Excel
      // and a hand-typed list.
      const values = text
        .trim()
        .split(/[\t,;\n\r]|\s{2,}/)
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map(parseNum);
      if (values.length < 2) return; // a single value is a normal paste
      e.preventDefault();
      let m = month;
      for (const v of values) {
        if (m > 11) break;
        onChange?.(row.key, m, v);
        m++;
      }
    },
    [onChange],
  );

  const monthTotals = useMemo(
    () => MONTH_NAMES.map((_, m) => rows.reduce((s, r) => s + (r.proposed[m] ?? 0), 0)),
    [rows],
  );
  const approvedMonthTotals = useMemo(
    () => MONTH_NAMES.map((_, m) => rows.reduce((s, r) => s + (r.approved[m] ?? 0), 0)),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <div className="mm-card">
        <p className="py-8 text-center text-[13px] text-brand-muted">
          No budget lines match this filter. Widen the Segment or BU filter above.
        </p>
      </div>
    );
  }

  return (
    <div className="mm-table-wrap overflow-x-auto">
      <table ref={gridRef} className="mm-table" style={{ minWidth: showDelta ? 1420 : 1320 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-20 border-r border-brand-border text-left"
              style={{ width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6" }}
            >
              Line
            </th>
            {MONTH_NAMES.map((m) => (
              <th key={m} className="text-right">{m}</th>
            ))}
            <th className="text-right">FY total</th>
            {showDelta && <th className="text-right">Change</th>}
          </tr>
        </thead>
        <tbody>
          {grouped.map((g, gi) => {
            if (g.deptHead) {
              return (
                <tr key={`d${gi}`} style={{ background: "#F5F2EC" }}>
                  <td
                    colSpan={showDelta ? 15 : 14}
                    className="sticky left-0 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-brand-dark"
                    style={{ background: "#F5F2EC" }}
                  >
                    {g.deptHead}
                  </td>
                </tr>
              );
            }
            if (g.l1Head) {
              return (
                <tr key={`l${gi}`} style={{ background: "#FCFBF9" }}>
                  <td
                    colSpan={showDelta ? 15 : 14}
                    className="sticky left-0 px-3 py-1 pl-6 text-[12px] font-medium text-brand-muted"
                    style={{ background: "#FCFBF9" }}
                  >
                    {g.l1Head}
                  </td>
                </tr>
              );
            }
            const r = g.row!;
            const ri = g.index!;
            const rowDelta = sum(r.proposed) - sum(r.approved);
            return (
              <tr key={r.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-brand-border px-3 py-1.5 text-left font-normal"
                  style={{ width: STICKY_W, minWidth: STICKY_W, background: "#FFFFFF", paddingLeft: 34 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-brand-dark" title={r.cat_l2 ?? r.cat_l1}>
                      {r.cat_l2 ?? r.cat_l1}
                      <span className="ml-1.5 text-[11px] text-brand-subtle">{r.bu}</span>
                    </span>
                    {!readOnly && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => onCopyPriorYear?.(r.key)}
                          title={`Copy FY${priorFiscalYear ?? ""} actual into this row`}
                          className="rounded border border-brand-border px-1.5 text-[11px] text-brand-muted hover:text-brand-dark"
                        >
                          C
                        </button>
                        <button
                          type="button"
                          onClick={() => onClearRow?.(r.key)}
                          title="Clear this row"
                          className="rounded border border-brand-border px-1.5 text-[11px] text-brand-muted hover:text-[#DC2626]"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                </th>

                {MONTH_NAMES.map((_, m) => {
                  const v = r.proposed[m] ?? 0;
                  const a = r.approved[m] ?? 0;
                  const changed = Math.round(v) !== Math.round(a);
                  const d = v - a;
                  if (readOnly) {
                    return (
                      <td key={m} className="px-1 py-1 text-right tabular-nums">
                        <div
                          className="rounded px-1.5 py-1"
                          style={
                            changed
                              ? { background: CHANGED_BG, border: `1px solid ${CHANGED_BORDER}` }
                              : undefined
                          }
                        >
                          <div className="text-[13px]">{v ? thb(v) : EM_DASH}</div>
                          {showDelta && changed && (
                            <div className="text-[10px]" style={{ color: d > 0 ? OVER : UNDER }}>
                              {d > 0 ? "+" : "−"}
                              {Math.abs(Math.round(d)).toLocaleString("en-US")}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={m} className="px-0.5 py-0.5">
                      <div className="flex items-center gap-0.5">
                        <input
                          data-r={ri}
                          data-m={m}
                          className="mm-input w-full text-right tabular-nums"
                          style={{
                            height: 30,
                            padding: "0 6px",
                            fontSize: 13,
                            ...(changed
                              ? { background: CHANGED_BG, borderColor: CHANGED_BORDER }
                              : {}),
                          }}
                          defaultValue={v ? Math.round(v).toLocaleString("en-US") : "0"}
                          key={`${r.key}-${m}-${Math.round(v)}`}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => onKeyDown(e, ri, m)}
                          onPaste={(e) => onPaste(e, r, m)}
                          onBlur={(e) => {
                            const next = parseNum(e.currentTarget.value);
                            if (Math.round(next) !== Math.round(v)) onChange?.(r.key, m, next);
                          }}
                          title={changed ? `Approved: ${thb(a)}` : undefined}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => onFillRight?.(r.key, m)}
                          title="Fill this value rightward to December"
                          className="shrink-0 px-0.5 text-[11px] leading-none text-brand-subtle hover:text-brand-accent"
                        >
                          →
                        </button>
                      </div>
                    </td>
                  );
                })}

                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-brand-dark">
                  {thb(sum(r.proposed))}
                </td>
                {showDelta && (
                  <td
                    className="px-3 py-1.5 text-right tabular-nums"
                    style={{ color: rowDelta > 0 ? OVER : rowDelta < 0 ? UNDER : undefined }}
                  >
                    {rowDelta === 0
                      ? EM_DASH
                      : `${rowDelta > 0 ? "+" : "−"}${Math.abs(Math.round(rowDelta)).toLocaleString("en-US")}`}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-10">
          <tr style={{ background: "#F9F8F6", borderTop: "1px solid #D8CBB0" }}>
            <th
              scope="row"
              className="sticky left-0 z-20 border-r border-brand-border px-3 py-2 text-left font-semibold text-brand-dark"
              style={{ width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6" }}
            >
              Total — my lines
            </th>
            {monthTotals.map((t, m) => (
              <td
                key={m}
                className="px-2 py-2 text-right font-semibold tabular-nums"
                style={
                  Math.round(t) !== Math.round(approvedMonthTotals[m])
                    ? { background: CHANGED_BG }
                    : undefined
                }
              >
                {t ? thb(t) : EM_DASH}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-dark">
              {thb(sum(monthTotals))}
            </td>
            {showDelta && (
              <td
                className="px-3 py-2 text-right font-semibold tabular-nums"
                style={{
                  color:
                    sum(monthTotals) - sum(approvedMonthTotals) > 0
                      ? OVER
                      : sum(monthTotals) - sum(approvedMonthTotals) < 0
                        ? UNDER
                        : undefined,
                }}
              >
                {sum(monthTotals) - sum(approvedMonthTotals) === 0
                  ? EM_DASH
                  : `${sum(monthTotals) - sum(approvedMonthTotals) > 0 ? "+" : "−"}${Math.abs(Math.round(sum(monthTotals) - sum(approvedMonthTotals))).toLocaleString("en-US")}`}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
