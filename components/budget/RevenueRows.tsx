"use client";

import { useState } from "react";
import { MONTH_NAMES, EM_DASH, isCurrentMonth } from "@/components/spend/format";
import { GoalActualCell } from "@/components/spend/cells";
import type { RevenueNode } from "@/lib/revenue-goals";

// The revenue goal rows, rendered as a <tbody> INSIDE the budget grid's own
// table so they share its colgroup — the percentage under a budget cell is
// only meaningful if it sits in the same column as the goal it divides by.
//
// Goals are typed at channel level only. Every row above is a sum, so those
// rows render as text with no input: if a total could be typed independently
// of its parts they could disagree, and nothing in the data would say which
// was right.

const GOAL_BG = "#F4F7F4";
const GOAL_ACCENT = "#1F3A2B";

// Indent by DEPTH, not by level. The status level is optional, so a channel
// can sit at depth 4 (Owned store › Song Wat) or depth 5 (Specialty partners ›
// sell › Tudi); keying off the level name would collide a status node with its
// own children, and keying off a fixed channel indent would shove every
// statusless channel rightwards to make room for a level it does not have.
const INDENT_BY_DEPTH = [12, 26, 40, 54, 68, 82];
const indentFor = (depth: number) =>
  INDENT_BY_DEPTH[Math.min(depth, INDENT_BY_DEPTH.length - 1)];

interface Props {
  tree: RevenueNode;
  editable: boolean;
  fiscalYear: number;
  /**
   * May this VIEWER add/rename/deactivate a channel? A separate per-person
   * toggle from `editable` (which governs goal and actual figures): someone
   * may well be trusted to type a goal without being trusted to invent a
   * revenue stream. Hiding the control is a courtesy — the API enforces it.
   */
  canAddChannel?: boolean;
  /** CEO/SUPERADMIN only — same gate as goals. See migration 040. */
  onActualChange?: (channelId: string, month: number, value: number | null) => void;
  monthWidthCols: number;
  showDelta: boolean;
  onChange?: (channelId: string, month: number, value: number | null) => void;
  onAddChannel?: () => void;
  onToggleChannel?: (channelId: string, active: boolean) => void;
}

const parseNum = (s: string) => {
  const t = String(s).replace(/[^0-9.\-]/g, "");
  if (t.trim() === "") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

interface FlatRow { node: RevenueNode; depth: number }

function flatten(
  node: RevenueNode, open: Set<string>, depth = 0, out: FlatRow[] = [],
): FlatRow[] {
  out.push({ node, depth });
  if (open.has(node.key)) for (const c of node.children) flatten(c, open, depth + 1, out);
  return out;
}

export default function RevenueRows({
  tree,
  editable,
  fiscalYear,
  canAddChannel = false,
  onActualChange,
  monthWidthCols,
  showDelta,
  onChange,
  onAddChannel,
  onToggleChannel,
}: Props) {
  // Collapsed by default: the goal is one line above the budget until someone
  // asks what is behind it.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const rows = flatten(tree, open);
  const fyTotal = tree.months.reduce<number | null>(
    (s, v) => (v === null ? s : (s ?? 0) + v),
    null,
  );

  return (
    <tbody>
      {rows.map(({ node: n, depth }) => {
        const isTotal = n.level === "total";
        const isChannel = n.level === "channel";
        const hasKids = n.children.length > 0;
        const rowTotal = n.months.reduce<number | null>(
          (s, v) => (v === null ? s : (s ?? 0) + v),
          null,
        );
        // Null stays null all the way up: a year total is null only when every
        // month is null, the same rule the month cells follow. A year with one
        // known month is that month, not that month plus eleven zeroes.
        const rowActual = n.actuals.reduce<number | null>(
          (s, v) => (v === null ? s : (s ?? 0) + v),
          null,
        );
        // The goal for exactly the months an actual exists for. See
        // GoalActualCell's goalToDate: without it a year that is 8 months old
        // reports ~66% and reads as missing the target.
        const goalToDate = n.actuals.reduce<number | null>(
          (s, v, m) => (v === null ? s : (s ?? 0) + (n.months[m] ?? 0)),
          null,
        );
        return (
          <tr
            key={n.key}
            style={{
              background: GOAL_BG,
              ...(isTotal ? { boxShadow: `inset 3px 0 0 ${GOAL_ACCENT}` } : {}),
            }}
          >
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-brand-border py-1.5 pr-3 text-left font-normal"
              style={{ background: GOAL_BG, paddingLeft: indentFor(depth) }}
            >
              <div className="flex items-center gap-1.5">
                {hasKids ? (
                  <button
                    type="button"
                    onClick={() => toggle(n.key)}
                    aria-expanded={open.has(n.key)}
                    className="shrink-0 text-[10px] text-brand-muted hover:text-brand-dark"
                    style={{ width: 12 }}
                  >
                    {open.has(n.key) ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="shrink-0" style={{ width: 12 }} />
                )}
                <span
                  className={`truncate text-[13px] ${isTotal ? "font-semibold text-brand-dark" : "text-brand-dark"}`}
                  title={n.label}
                >
                  {n.label}
                </span>
                {isChannel && n.active === false && (
                  <span className="shrink-0 text-[10px] text-brand-subtle">(closed)</span>
                )}
                {isChannel && canAddChannel && onToggleChannel && (
                  <button
                    type="button"
                    onClick={() => onToggleChannel(n.channelId!, !(n.active ?? true))}
                    title={
                      n.active === false
                        ? "Reopen this channel"
                        : "Close this channel — its past goals are kept, never deleted"
                    }
                    className="ml-auto shrink-0 rounded border border-brand-border px-1 text-[10px] text-brand-muted hover:text-brand-dark"
                  >
                    {n.active === false ? "open" : "close"}
                  </button>
                )}
              </div>
            </th>

            {MONTH_NAMES.map((_, m) => {
              const v = n.months[m];
              const a = n.actuals[m];
              const partial = isCurrentMonth(fiscalYear, m + 1);

              // Channel rows, for a CEO/admin: both figures are typed. Goal on
              // top, actual beneath, matching the read-only cell above so the
              // eye does not have to re-learn the layout in edit mode.
              if (isChannel && editable) {
                return (
                  <td key={m} className="py-1" style={{ paddingLeft: 2, paddingRight: 10 }}>
                    <div className="flex items-center gap-1">
                      <span className="flex-none uppercase" style={{ fontSize: 8, letterSpacing: "0.06em", color: "#A9A497" }}>G</span>
                      <input
                        data-goal={n.channelId}
                        data-m={m}
                        className="mm-input w-full text-right tabular-nums"
                        style={{ height: 22, padding: "0 6px", fontSize: 11, background: "#FFFFFF" }}
                        defaultValue={v === null ? "" : Math.round(v).toLocaleString("en-US")}
                        key={`${n.key}-g-${m}-${v ?? "x"}`}
                        placeholder={EM_DASH}
                        title="Goal. Blank means not yet open — not a target of zero"
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          const next = parseNum(e.currentTarget.value);
                          const before = v === null ? null : Math.round(v);
                          if ((next === null ? null : Math.round(next)) !== before) {
                            onChange?.(n.channelId!, m + 1, next);
                          }
                        }}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="flex-none uppercase" style={{ fontSize: 8, letterSpacing: "0.06em", color: "#A9A497" }}>A</span>
                      <input
                        data-actual={n.channelId}
                        data-m={m}
                        className="mm-input w-full text-right font-bold tabular-nums"
                        style={{ height: 22, padding: "0 6px", fontSize: 11.5, background: "#FFFFFF" }}
                        defaultValue={a === null ? "" : Math.round(a).toLocaleString("en-US")}
                        key={`${n.key}-a-${m}-${a ?? "x"}`}
                        placeholder={EM_DASH}
                        title="Actual. Blank means not yet known — never a zero. Normally synced from the revenue sheet; typed here until that sync exists."
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          const next = parseNum(e.currentTarget.value);
                          const before = a === null ? null : Math.round(a);
                          if ((next === null ? null : Math.round(next)) !== before) {
                            onActualChange?.(n.channelId!, m + 1, next);
                          }
                        }}
                      />
                    </div>
                  </td>
                );
              }

              return (
                <td
                  key={m}
                  className="py-1 text-right"
                  style={{ paddingLeft: 2, paddingRight: 10 }}
                  // An em dash is not a zero. Say which it is on hover, so
                  // nobody reads a blank month as a missed target.
                  title={
                    v === null && a === null
                      ? "Not yet open — no goal set, and no actual known"
                      : a === null
                        ? "No actual known yet for this month"
                        : undefined
                  }
                >
                  <GoalActualCell goal={v} actual={a} partial={partial} />
                </td>
              );
            })}

            {/* Goal AND actual for the year, in the same shape as a month
                cell, so the eye reads the total the way it reads the months
                rather than switching conventions at the last column. */}
            <td
              className="px-3 py-1.5 text-right align-top"
              title={
                rowActual === null
                  ? "No actual known yet for any month this year"
                  : goalToDate !== rowTotal
                    ? "Actual is year-to-date; the percentage divides by the goal for those months only"
                    : undefined
              }
            >
              <GoalActualCell goal={rowTotal} actual={rowActual} goalToDate={goalToDate} />
            </td>
            {showDelta && <td />}
          </tr>
        );
      })}

      {canAddChannel && onAddChannel && (
        <tr style={{ background: GOAL_BG }}>
          <th
            scope="row"
            className="sticky left-0 z-10 border-r border-brand-border py-1.5 pr-3 text-left font-normal"
            style={{ background: GOAL_BG, paddingLeft: indentFor(5) }}
          >
            <button
              type="button"
              onClick={onAddChannel}
              // Whose permission this is, spelled out. A revenue channel is
              // company-wide — it is not part of the budget owner's data — so
              // this follows the SIGNED-IN VIEWER, not the owner whose budget
              // is on screen. An admin acting on someone's behalf therefore
              // sees it and that person does not, which is correct and has
              // been mistaken for a bug.
              title="Add a revenue channel. Channels are company-wide, not this owner's — you see this because YOU hold the Revenue channels permission."
              className="rounded-[5px] border border-dashed border-brand-border px-2 py-0.5 text-[11px] text-brand-muted hover:border-brand-accent hover:text-brand-accent"
            >
              + Add channel
            </button>
          </th>
          <td colSpan={monthWidthCols + (showDelta ? 2 : 1)} />
        </tr>
      )}

      {/* Separates the goal block from the budget rows it is the denominator
          for — without it the two read as one continuous table. */}
      <tr>
        <td
          colSpan={monthWidthCols + (showDelta ? 3 : 2)}
          style={{ height: 6, borderBottom: "1px solid #D8CBB0", background: "#FFFFFF" }}
        />
      </tr>
      <tr hidden>
        <td>{fyTotal}</td>
      </tr>
    </tbody>
  );
}
