"use client";

import {
  ALL_BRANCHES, ALL_BRANCHES_LABEL, NO_BRANCH, NO_BRANCH_LABEL,
  branchColour, type Branch,
} from "@/lib/branches-shared";

// The branch SELECTOR. Branch is never another nesting level.
//
// ===========================================================================
// WHY A SELECTOR AND NOT A LEVEL IN THE GRID.
// ===========================================================================
// Retail carries ~39 category coordinates and there are 16 branches. Nesting
// branch inside the grid would be ~600 rows to scroll past to reach one
// figure, and dragging a category to reorder it would have to mean something
// across all 16 at once. One branch at a time is the only shape that stays
// usable, so the bar switches context rather than expanding it.
//
// "All branches" is READ-ONLY and sums every branch. That is not a limitation
// to work around later: a figure typed into a sum has no single branch to be
// written to, and splitting it automatically would invent an allocation nobody
// chose.

interface Props {
  branches: Branch[];
  selected: string;
  onSelect: (value: string) => void;
  /** Branch values holding unsaved edits — the dot. */
  dirtyBranches: Set<string>;
  /** Branch values that already hold lines in this fiscal year. */
  branchesWithLines: Set<string>;
  fiscalYear: number;
  busy?: boolean;
}

export default function BranchBar({
  branches, selected, onSelect, dirtyBranches, branchesWithLines, fiscalYear, busy,
}: Props) {
  const groups = Array.from(new Set(branches.map((b) => b.group)));

  const Chip = ({
    value, label, colour, closed, disabled, title,
  }: {
    value: string; label: string; colour?: string;
    closed?: boolean; disabled?: boolean; title?: string;
  }) => {
    const active = selected === value;
    const dirty = dirtyBranches.has(value);
    return (
      <button
        type="button"
        onClick={() => !disabled && onSelect(value)}
        disabled={disabled || busy}
        title={title}
        className="relative flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[12.5px] transition-colors disabled:cursor-not-allowed"
        style={{
          borderColor: active ? "#1F3A2B" : "#D8CBB0",
          background: active ? "#1F3A2B" : "#FFFFFF",
          color: active ? "#FFFFFF" : disabled ? "#9CA3AF" : "#1A1A1A",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {colour && (
          <span
            aria-hidden
            style={{
              width: 8, height: 8, borderRadius: 2, flex: "none",
              background: colour,
              outline: active ? "1px solid rgba(255,255,255,.6)" : "none",
            }}
          />
        )}
        <span className={closed ? "line-through decoration-1" : undefined}>{label}</span>
        {closed && (
          <span className="text-[10px]" style={{ color: active ? "#D8CBB0" : "#8E2A21" }}>
            closed
          </span>
        )}
        {/* Unsaved work on a branch you are not looking at. Without this,
            switching branch mid-edit loses the edit with nothing on screen
            having said so. */}
        {dirty && (
          <span
            title="Unsaved changes on this branch"
            style={{
              width: 6, height: 6, borderRadius: 99, flex: "none",
              background: active ? "#FFFFFF" : "#BD5A2E",
            }}
          />
        )}
      </button>
    );
  };

  return (
    <div
      className="rounded-[10px] px-3 py-2"
      style={{ background: "#FDFCFB", border: "1px solid #F0EAE0" }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-[0.05em] text-brand-subtle">
          Branch
        </span>

        <Chip
          value={ALL_BRANCHES}
          label={ALL_BRANCHES_LABEL}
          title="Every branch summed. Read-only — a figure typed into a sum has no single branch to be written to."
        />

        {groups.map((g) => (
          <span key={g} className="flex flex-wrap items-center gap-1.5">
            <span className="ml-1 text-[10px] text-brand-subtle">{g}</span>
            {branches
              .filter((b) => b.group === g)
              .map((b) => {
                // A closed branch is OFFERED for a year it already budgets in,
                // and refused for a year it does not — the same rule revenue
                // goals follow, reused rather than restated.
                const disabled = (b.closed || !b.active) && !branchesWithLines.has(b.name);
                return (
                  <Chip
                    key={b.name}
                    value={b.name}
                    label={b.name}
                    colour={branchColour(b.name)}
                    closed={b.closed || !b.active}
                    disabled={disabled}
                    title={
                      disabled
                        ? `${b.name} is closed and has no FY${fiscalYear} lines — it cannot be given a new year's budget. Its past years are unchanged.`
                        : b.closed
                          ? `${b.name} is closed. FY${fiscalYear} lines already exist, so they stay editable.`
                          : undefined
                    }
                  />
                );
              })}
          </span>
        ))}

        <span className="mx-1 h-4 w-px" style={{ background: "#E5E0D5" }} />
        <Chip
          value={NO_BRANCH}
          label={NO_BRANCH_LABEL}
          title="Retail spend not attributable to one branch. Retail's own data already needs this — 26 FY2026 requests name the branch &quot;All branch&quot;."
        />
      </div>

      {selected === ALL_BRANCHES && (
        <p className="mt-1.5 text-[11.5px] text-brand-muted">
          Showing every branch summed. <strong>Read-only</strong> — pick one branch to edit.
        </p>
      )}
    </div>
  );
}
