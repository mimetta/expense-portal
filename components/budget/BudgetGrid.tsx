"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MONTH_NAMES, thb, EM_DASH } from "@/components/spend/format";
import RevenueRows from "@/components/budget/RevenueRows";
import type { EditorRow } from "@/lib/budget-editor";
import type { RevenueNode } from "@/lib/revenue-goals";
import { applyCategoryOrder, type CategoryOrderRow } from "@/lib/budget-order-shared";

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

// Column widths. The number is the thing that must never clip: a realistic
// figure here is 7 digits with separators ("1,250,000"), ~62px at 13px
// tabular-nums. MONTH_W is built up from that, not guessed:
//
//   112 = 2 (cell pad-left) + 94 (input) + 16 (fill-right gutter)
//    94 = 8 (input pad-left) + 78 (text) + 8 (input pad-right)
//
// leaving ~16px of slack on a 7-digit figure, and still fitting 8 digits.
// The fill-right arrow lives in the 16px gutter OUTSIDE the input, so it can
// never overlap the number — it used to sit inside the cell's flex row and
// take width away from it.
//
// The line column is sized from real names, not from what is left over.
// wacharanan.j's 100 lines run to 34 characters ("Quarterly Factory Worker
// Gathering", "IT Equipment (laptop for new hire)"), p90 28, and two rows in
// one group can differ only in their tail — "Logistic Staff
// (pick/pack/delivery)" vs "Stock Staff (Warehouse)" — so truncating at ~20
// makes them indistinguishable. 340px fits the p90 outright; every name also
// carries a title with its full dept > cat_l1 > cat_l2 path.
//
// This width comes from the TABLE, never from the month cells: the grid
// already scrolls horizontally at every viewport, since the page content
// column is capped at 1280px regardless.
const STICKY_W = 340;
const MONTH_W = 112;
const TOTAL_W = 150;
const GUTTER_W = 16;

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
  /** The year these rows belong to — used to mark the current month partial. */
  fiscalYear: number;
  /**
   * The owner's own category order, and the callback that saves a new one.
   * Absent = default alphabetical. Reordering writes only to
   * budget_category_order — never a figure, never a revision, never an audit
   * row against one. See migration 041.
   */
  categoryOrder?: CategoryOrderRow[];
  onReorderCategories?: (department: string, catL1s: string[]) => void;
  /**
   * localStorage key for the collapse state. Collapse is per READER (which
   * rows they want out of the way right now), unlike the category order which
   * is per OWNER — so it lives in the browser and not the database.
   * Undefined disables persistence.
   */
  collapseStorageKey?: string;
  /** Lifted so the page can drive Collapse all / Expand all from the toolbar. */
  collapseSignal?: { collapsed: boolean; nonce: number } | null;
  /** The revenue goal block, rendered above the budget rows. */
  revenue?: {
    tree: RevenueNode;
    editable: boolean;
    /** Separate from `editable`: who may add/rename/deactivate a channel. */
    canAddChannel?: boolean;
    onChange?: (channelId: string, month: number, value: number | null) => void;
    /** CEO/SUPERADMIN only — same gate as goals. See migration 040. */
    onActualChange?: (channelId: string, month: number, value: number | null) => void;
    onAddChannel?: () => void;
    onToggleChannel?: (channelId: string, active: boolean) => void;
  } | null;
}

/**
 * A budget figure as a share of that month's revenue goal. Null where there
 * is no goal — dividing by a month that is "not yet open" would invent a
 * percentage out of nothing.
 */
function shareOfGoal(amount: number, goal: number | null | undefined): string | null {
  if (goal === null || goal === undefined || goal === 0) return null;
  const pct = (amount / goal) * 100;
  if (!Number.isFinite(pct)) return null;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}% of goal`;
}

interface CatGroup { l1: string; lines: { row: EditorRow; index: number }[] }
interface DeptGroup { dept: string; cats: CatGroup[] }

/**
 * dept → cat_l1 → cat_l2, nested rather than flat.
 *
 * It was a flat list of heading/row markers, which was enough to RENDER the
 * hierarchy but not to operate on it: collapsing a department and dragging a
 * category both need to know which rows belong to which group, and a flat
 * list only knows what comes next.
 *
 * Category order within a department comes from the owner's saved order;
 * departments stay alphabetical, since nothing lets them be reordered.
 */
function group(rows: EditorRow[], order: CategoryOrderRow[]): DeptGroup[] {
  const byDept = new Map<string, Map<string, { row: EditorRow; index: number }[]>>();
  rows.forEach((row, index) => {
    let cats = byDept.get(row.department);
    if (!cats) { cats = new Map(); byDept.set(row.department, cats); }
    let lines = cats.get(row.cat_l1);
    if (!lines) { lines = []; cats.set(row.cat_l1, lines); }
    lines.push({ row, index });
  });
  return Array.from(byDept.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dept, cats]) => ({
      dept,
      cats: applyCategoryOrder(Array.from(cats.keys()), order, dept)
        .map((l1) => ({ l1, lines: cats.get(l1)! })),
    }));
}

const deptKey = (d: string) => `d:${d}`;
const catKey = (d: string, l1: string) => `c:${d}|${l1}`;

/**
 * A line's own name: its cat_l2, falling back to the cat_l1 when the category
 * has no second level.
 *
 * `??` was wrong here. Migration 029 made budget_lines.cat_l2 NOT NULL
 * DEFAULT '', so a category with no second level arrives as "" rather than
 * null — and `"" ?? x` is `""`, not `x`. The fallback silently stopped firing
 * and those rows rendered with a completely blank name: 4 of wacharanan.j's
 * 100 lines, and 62 of the 352 rows in `categories` have a blank cat_l2.
 */
const lineLabel = (r: EditorRow) => (r.cat_l2?.trim() ? r.cat_l2 : r.cat_l1);

/** Full path on hover — the truncated label alone can be ambiguous. */
const lineTitle = (r: EditorRow) =>
  [r.department, r.cat_l1, r.cat_l2?.trim() || null].filter(Boolean).join(" › ") + ` · ${r.bu}`;

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
  fiscalYear,
  categoryOrder = [],
  onReorderCategories,
  collapseStorageKey,
  collapseSignal = null,
  revenue = null,
}: GridProps) {
  const gridRef = useRef<HTMLTableElement>(null);
  const readOnly = onChange === null;
  const grouped = useMemo(() => group(rows, categoryOrder), [rows, categoryOrder]);

  // --- collapse ------------------------------------------------------------
  // A set of COLLAPSED keys, so the default (absent from the set) is expanded
  // and a newly appearing department or category is open rather than hidden.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    if (!collapseStorageKey) return;
    hydrated.current = false;
    try {
      const raw = window.localStorage.getItem(collapseStorageKey);
      setCollapsed(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setCollapsed(new Set()); }
    hydrated.current = true;
  }, [collapseStorageKey]);

  useEffect(() => {
    // Only write AFTER the key's own state has been read back, or the first
    // render would overwrite the stored set with an empty one.
    if (!collapseStorageKey || !hydrated.current) return;
    try { window.localStorage.setItem(collapseStorageKey, JSON.stringify(Array.from(collapsed))); } catch { /* private mode */ }
  }, [collapsed, collapseStorageKey]);

  // Collapse all / Expand all, driven from the page toolbar. The nonce lets
  // the same action fire twice in a row.
  useEffect(() => {
    if (!collapseSignal) return;
    if (!collapseSignal.collapsed) { setCollapsed(new Set()); return; }
    const all = new Set<string>();
    for (const d of grouped) {
      all.add(deptKey(d.dept));
      for (const c of d.cats) all.add(catKey(d.dept, c.l1));
    }
    setCollapsed(all);
    // grouped is intentionally not a dependency: this must run when the
    // BUTTON is pressed, not every time the rows re-group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseSignal?.nonce, collapseSignal?.collapsed]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // --- drag to reorder categories -----------------------------------------
  // Keyed by department: a drag that starts in one department can only ever
  // drop inside it, which is what makes "must not be possible to move a
  // category between departments" true in the UI as well as in the API.
  const [drag, setDrag] = useState<{ dept: string; l1: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const dropOn = useCallback((dept: string, targetL1: string) => {
    setOver(null);
    const d = drag; setDrag(null);
    if (!d || d.dept !== dept || d.l1 === targetL1) return;
    const cats = grouped.find((g) => g.dept === dept)?.cats.map((c) => c.l1) ?? [];
    const from = cats.indexOf(d.l1), to = cats.indexOf(targetL1);
    if (from < 0 || to < 0) return;
    const next = [...cats];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorderCategories?.(dept, next);
  }, [drag, grouped, onReorderCategories]);
  const totalWidth = STICKY_W + 12 * MONTH_W + TOTAL_W + (showDelta ? TOTAL_W : 0);
  // The denominator for the share-of-goal line under every budget cell: the
  // root of the revenue tree, fetched with the selected company. Since
  // "Both" was removed that root is ALWAYS a single company's goal, so a
  // budget line for company X is divided by X's goal and never by a combined
  // ONEST+SV figure — which is what made the old percentage misleading for
  // an owner holding lines in both.
  const goalMonths = revenue?.tree.months ?? null;

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
    // THE SCROLL CONTAINER. Sticky positions resolve against the nearest
    // scrollable ancestor, so the header can only pin if this div — not the
    // page — is what scrolls. max-height caps it; overflow:auto inline beats
    // mm-table-wrap's own overflow-hidden.
    <div className="mm-table-wrap" style={{ overflow: "auto", maxHeight: "68vh" }}>
      <table
        ref={gridRef}
        className="mm-table"
        // Fixed layout + a colgroup so every month column is exactly MONTH_W
        // in thead, tbody and tfoot alike. Under auto layout a long line name
        // or a wide total silently steals width back from the month cells,
        // which is how they got clipped in the first place.
        style={{ tableLayout: "fixed", width: totalWidth, minWidth: totalWidth }}
      >
        <colgroup>
          <col style={{ width: STICKY_W }} />
          {MONTH_NAMES.map((m) => (
            <col key={m} style={{ width: MONTH_W }} />
          ))}
          <col style={{ width: TOTAL_W }} />
          {showDelta && <col style={{ width: TOTAL_W }} />}
        </colgroup>
        <thead>
          <tr>
            {/* THE CORNER CELL — sticky on BOTH axes, and above every other
                sticky cell. It is the one that breaks if the z-order is
                wrong: at z equal to the month headers it slides under the
                line column while scrolling right, and at z equal to the line
                column it is overrun by the month headers when scrolling down.
                It must outrank both. Preflight sets border-collapse:collapse,
                under which a sticky cell's own border is not painted, so the
                edges are drawn with inset box-shadow instead. */}
            <th
              className="sticky left-0 top-0 text-left"
              style={{
                width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6", zIndex: 40,
                boxShadow: "inset -1px 0 0 #D8CBB0, inset 0 -1px 0 #D8CBB0",
              }}
            >
              Line
            </th>
            {MONTH_NAMES.map((m) => (
              <th
                key={m}
                className="sticky top-0 text-right"
                style={{ background: "#F9F8F6", zIndex: 30, boxShadow: "inset 0 -1px 0 #D8CBB0" }}
              >
                {m}
              </th>
            ))}
            <th
              className="sticky top-0 text-right"
              style={{ background: "#F9F8F6", zIndex: 30, boxShadow: "inset 0 -1px 0 #D8CBB0" }}
            >
              FY total
            </th>
            {showDelta && (
              <th
                className="sticky top-0 text-right"
                style={{ background: "#F9F8F6", zIndex: 30, boxShadow: "inset 0 -1px 0 #D8CBB0" }}
              >
                Change
              </th>
            )}
          </tr>
        </thead>
        {revenue && (
          <RevenueRows
            tree={revenue.tree}
            editable={revenue.editable}
            canAddChannel={revenue.canAddChannel}
            fiscalYear={fiscalYear}
            onActualChange={revenue.onActualChange}
            monthWidthCols={12}
            showDelta={showDelta}
            onChange={revenue.onChange}
            onAddChannel={revenue.onAddChannel}
            onToggleChannel={revenue.onToggleChannel}
          />
        )}
        <tbody>
          {grouped.flatMap((gd) => {
            const dOpen = !collapsed.has(deptKey(gd.dept));
            const lineCount = gd.cats.reduce((n, c) => n + c.lines.length, 0);
            const out: React.ReactNode[] = [
              <tr key={`d:${gd.dept}`} style={{ background: "#F5F2EC" }}>
                <td
                  colSpan={showDelta ? 15 : 14}
                  className="sticky left-0 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-brand-dark"
                  style={{ background: "#F5F2EC" }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(deptKey(gd.dept))}
                    aria-expanded={dOpen}
                    className="mr-1.5 text-[10px] text-brand-muted hover:text-brand-dark"
                    style={{ width: 12 }}
                  >
                    {dOpen ? "▾" : "▸"}
                  </button>
                  {gd.dept}
                  <span className="ml-2 text-[10.5px] font-normal normal-case tracking-normal text-brand-muted">
                    {gd.cats.length} categor{gd.cats.length === 1 ? "y" : "ies"} · {lineCount} line{lineCount === 1 ? "" : "s"}
                  </span>
                </td>
              </tr>,
            ];
            if (!dOpen) return out;

            for (const gc of gd.cats) {
              const cOpen = !collapsed.has(catKey(gd.dept, gc.l1));
              const isOver = over === catKey(gd.dept, gc.l1) && drag?.dept === gd.dept;
              out.push(
                <tr
                  key={`c:${gd.dept}|${gc.l1}`}
                  // Reordering is only offered when the grid is editable and a
                  // handler exists — a CEO reviewing a submitted revision has
                  // no arrangement of their own to save.
                  draggable={!readOnly && !!onReorderCategories}
                  onDragStart={() => setDrag({ dept: gd.dept, l1: gc.l1 })}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDragOver={(e) => {
                    // Only a same-department drag is a valid drop target, so
                    // preventDefault is withheld otherwise and the browser
                    // shows "not allowed".
                    if (drag?.dept !== gd.dept) return;
                    e.preventDefault();
                    setOver(catKey(gd.dept, gc.l1));
                  }}
                  onDragLeave={() => setOver((k) => (k === catKey(gd.dept, gc.l1) ? null : k))}
                  onDrop={(e) => { e.preventDefault(); dropOn(gd.dept, gc.l1); }}
                  style={{
                    background: "#FCFBF9",
                    opacity: drag?.dept === gd.dept && drag.l1 === gc.l1 ? 0.4 : 1,
                    boxShadow: isOver ? "inset 0 2px 0 #BD5A2E" : undefined,
                  }}
                >
                  <td
                    colSpan={showDelta ? 15 : 14}
                    className="sticky left-0 px-3 py-1 pl-6 text-[12px] font-medium text-brand-muted"
                    style={{ background: "#FCFBF9" }}
                  >
                    {!readOnly && onReorderCategories && (
                      <span
                        className="mr-1.5 cursor-grab select-none text-[13px] text-brand-subtle hover:text-brand-brown"
                        title={`Drag to reorder within ${gd.dept}. Your order only — nobody else sees it, and the spend report is unaffected.`}
                      >
                        ⠿
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(catKey(gd.dept, gc.l1))}
                      aria-expanded={cOpen}
                      className="mr-1.5 text-[10px] text-brand-muted hover:text-brand-dark"
                      style={{ width: 12 }}
                    >
                      {cOpen ? "▾" : "▸"}
                    </button>
                    {gc.l1}
                    <span className="ml-2 text-[10.5px] font-normal text-brand-subtle">
                      {gc.lines.length}
                    </span>
                  </td>
                </tr>,
              );
              if (!cOpen) continue;

              for (const { row: r, index: ri } of gc.lines) {
                const rowDelta = sum(r.proposed) - sum(r.approved);
                out.push(
              <tr key={r.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-brand-border px-3 py-1.5 text-left font-normal"
                  style={{ width: STICKY_W, minWidth: STICKY_W, background: "#FFFFFF", paddingLeft: 34 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-brand-dark" title={lineTitle(r)}>
                      {lineLabel(r)}
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
                          {v > 0 && shareOfGoal(v, goalMonths?.[m]) && (
                            <div className="text-[10px] text-brand-subtle">
                              {shareOfGoal(v, goalMonths?.[m])}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={m}
                      className="group relative py-0.5"
                      style={{ paddingLeft: 2, paddingRight: GUTTER_W }}
                    >
                      <div>
                        <input
                          data-r={ri}
                          data-m={m}
                          className="mm-input w-full text-right tabular-nums"
                          style={{
                            height: 30,
                            padding: "0 8px",
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
                        {/* In the gutter to the right of the input, never over
                            it. Hidden until the cell is hovered or focused. */}
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => onFillRight?.(r.key, m)}
                          title="Fill this value rightward to December"
                          className="absolute inset-y-0.5 right-0 flex items-center justify-center text-[11px] leading-none text-brand-subtle opacity-0 transition-opacity hover:text-brand-accent group-hover:opacity-100 group-focus-within:opacity-100"
                          style={{ width: GUTTER_W }}
                        >
                          →
                        </button>
                        {/* Share of that month's revenue goal — same small
                            muted treatment Variance and Used already use in
                            the spend report. Absent when the month has no
                            goal, rather than shown as 0%. */}
                        {v > 0 && shareOfGoal(v, goalMonths?.[m]) && (
                          <div className="pr-2 text-right text-[10px] leading-tight text-brand-subtle">
                            {shareOfGoal(v, goalMonths?.[m])}
                          </div>
                        )}
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
              </tr>,
                );
              }
            }
            return out;
          })}
        </tbody>
        <tfoot>
          <tr>
            {/* The footer's own corner: sticky both ways like the header's,
                one rank above the month totals for the same reason. */}
            <th
              scope="row"
              className="sticky bottom-0 left-0 px-3 py-2 text-left font-semibold text-brand-dark"
              style={{
                width: STICKY_W, minWidth: STICKY_W, background: "#F9F8F6", zIndex: 40,
                boxShadow: "inset -1px 0 0 #D8CBB0, inset 0 1px 0 #D8CBB0",
              }}
            >
              Total — my lines
            </th>
            {monthTotals.map((t, m) => (
              <td
                key={m}
                className="sticky bottom-0 py-2 text-right font-semibold tabular-nums"
                // Same right gutter as the body cells so the footer total sits
                // under the inputs rather than 14px to their right.
                style={{
                  paddingLeft: 2,
                  paddingRight: GUTTER_W,
                  zIndex: 30,
                  background: Math.round(t) !== Math.round(approvedMonthTotals[m]) ? CHANGED_BG : "#F9F8F6",
                  boxShadow: "inset 0 1px 0 #D8CBB0",
                }}
              >
                {t ? thb(t) : EM_DASH}
              </td>
            ))}
            <td
              className="sticky bottom-0 px-3 py-2 text-right font-semibold tabular-nums text-brand-dark"
              style={{ zIndex: 30, background: "#F9F8F6", boxShadow: "inset 0 1px 0 #D8CBB0" }}
            >
              {thb(sum(monthTotals))}
            </td>
            {showDelta && (
              <td
                className="sticky bottom-0 px-3 py-2 text-right font-semibold tabular-nums"
                style={{
                  zIndex: 30, background: "#F9F8F6", boxShadow: "inset 0 1px 0 #D8CBB0",
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
