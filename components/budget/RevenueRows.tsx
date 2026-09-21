"use client";

import { useState } from "react";
import { MONTH_NAMES, thb, EM_DASH } from "@/components/spend/format";
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

const INDENT: Record<RevenueNode["level"], number> = {
  total: 12,
  bu: 26,
  category: 40,
  sub_category: 54,
  channel: 68,
};

interface Props {
  tree: RevenueNode;
  editable: boolean;
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

function flatten(node: RevenueNode, open: Set<string>, out: RevenueNode[] = []): RevenueNode[] {
  out.push(node);
  if (open.has(node.key)) for (const c of node.children) flatten(c, open, out);
  return out;
}

export default function RevenueRows({
  tree,
  editable,
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
      {rows.map((n) => {
        const isTotal = n.level === "total";
        const isChannel = n.level === "channel";
        const hasKids = n.children.length > 0;
        const rowTotal = n.months.reduce<number | null>(
          (s, v) => (v === null ? s : (s ?? 0) + v),
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
              style={{ background: GOAL_BG, paddingLeft: INDENT[n.level] }}
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
                {isChannel && editable && onToggleChannel && (
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
              if (isChannel && editable) {
                return (
                  <td key={m} className="py-0.5" style={{ paddingLeft: 2, paddingRight: 16 }}>
                    <input
                      data-goal={n.channelId}
                      data-m={m}
                      className="mm-input w-full text-right tabular-nums"
                      style={{ height: 26, padding: "0 8px", fontSize: 12.5, background: "#FFFFFF" }}
                      defaultValue={v === null ? "" : Math.round(v).toLocaleString("en-US")}
                      key={`${n.key}-${m}-${v ?? "x"}`}
                      placeholder={EM_DASH}
                      title="Blank means not yet open — not a target of zero"
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const next = parseNum(e.currentTarget.value);
                        const before = v === null ? null : Math.round(v);
                        if ((next === null ? null : Math.round(next)) !== before) {
                          onChange?.(n.channelId!, m + 1, next);
                        }
                      }}
                    />
                  </td>
                );
              }
              return (
                <td
                  key={m}
                  className="py-1.5 text-right tabular-nums"
                  style={{ paddingLeft: 2, paddingRight: 16 }}
                >
                  <span
                    className={`text-[12.5px] ${isTotal ? "font-semibold text-brand-dark" : "text-brand-muted"}`}
                    // An em dash is not a zero. Say which it is on hover, so
                    // nobody reads a blank month as a missed target.
                    title={v === null ? "Not yet open — no goal set for this month" : undefined}
                  >
                    {v === null ? EM_DASH : thb(v)}
                  </span>
                </td>
              );
            })}

            <td className="px-3 py-1.5 text-right tabular-nums">
              <span className={`text-[12.5px] ${isTotal ? "font-semibold text-brand-dark" : "text-brand-muted"}`}>
                {rowTotal === null ? EM_DASH : thb(rowTotal)}
              </span>
            </td>
            {showDelta && <td />}
          </tr>
        );
      })}

      {editable && onAddChannel && (
        <tr style={{ background: GOAL_BG }}>
          <th
            scope="row"
            className="sticky left-0 z-10 border-r border-brand-border py-1.5 pr-3 text-left font-normal"
            style={{ background: GOAL_BG, paddingLeft: INDENT.channel }}
          >
            <button
              type="button"
              onClick={onAddChannel}
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
