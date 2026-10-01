"use client";

import {
  ALL_BRANCHES, ALL_BRANCHES_LABEL, NO_BRANCH, NO_BRANCH_LABEL,
  BRANCH_GROUP_ORDER, BRANCH_STATUS_ORDER, branchColour, type Branch,
} from "@/lib/branches-shared";

// The branch SELECTOR. Branch is never another nesting level.
//
// ===========================================================================
// WHY A SELECTOR AND NOT A LEVEL IN THE GRID.
// ===========================================================================
// Retail carries ~19 category coordinates per company and there are 16
// branches. Nesting branch inside the grid would be hundreds of rows to scroll
// past to reach one figure, and dragging a category to reorder would have to
// mean something across every branch at once. One branch at a time is the only
// shape that stays usable, so this switches context rather than expanding it.
//
// ===========================================================================
// WHY A DROPDOWN AND NOT CHIPS.
// ===========================================================================
// This was a row of chips. Sixteen branches wrapped onto three lines at
// 1280px, and every store added makes it worse — the control grew with the
// data, which a selector must not. A <select> is one line whatever the branch
// count, and optgroups carry the same hierarchy the chip group labels did.
//
// What a <select> cannot carry is colour, and the unsaved-changes dot. Both
// are kept, outside it: the swatch and the dot sit beside the control for the
// CURRENT value, and the dot is repeated as a marker in the option text so a
// branch with pending edits is findable in the list.
//
// "All branches" is READ-ONLY and sums every branch. Not a limitation to work
// around later: a figure typed into a sum has no single branch to be written
// to, and splitting it automatically would invent an allocation nobody chose.

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

/**
 * Budgetable if it already budgets here, OR it traded here. The second matters
 * because branch budgeting is new: without it a closed branch still accruing
 * cost this year could never be given a budget at all.
 */
const isDisabled = (b: Branch, withLines: Set<string>) =>
  (b.closed || !b.active) && !withLines.has(b.name) && !b.tradedThisYear;

export default function BranchBar({
  branches, selected, onSelect, dirtyBranches, branchesWithLines, fiscalYear, busy,
}: Props) {
  // `branches` arrives already ordered by lib/branches.ts#listBranches
  // (group → status → sort_order), so the groups below are built by walking it
  // in that order rather than sorting again — one ordering, in one place.
  const groups: { label: string; items: Branch[] }[] = [];
  for (const g of BRANCH_GROUP_ORDER) {
    const inGroup = branches.filter((b) => b.group === g);
    if (inGroup.length === 0) continue;
    const withStatus = inGroup.filter((b) => b.status);
    if (withStatus.length === 0) {
      groups.push({ label: g, items: inGroup });
      continue;
    }
    // A sub-category that uses the status level becomes one optgroup per
    // status — "Specialty partners › sell" — because <optgroup> cannot nest.
    for (const st of BRANCH_STATUS_ORDER) {
      const items = inGroup.filter((b) => b.status === st);
      if (items.length) groups.push({ label: `${g} › ${st}`, items });
    }
    const bare = inGroup.filter((b) => !b.status);
    if (bare.length) groups.push({ label: g, items: bare });
  }

  const current = branches.find((b) => b.name === selected);
  const dirtyHere = dirtyBranches.has(selected);
  const dirtyElsewhere = Array.from(dirtyBranches).filter((d) => d !== selected);

  return (
    <div
      className="rounded-[10px] px-3 py-2"
      style={{ background: "#FDFCFB", border: "1px solid #F0EAE0" }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.05em] text-brand-subtle">
            Branch
          </span>
          {/* The colour a <select> cannot show, for the current value. */}
          {current && (
            <span
              aria-hidden
              style={{
                width: 9, height: 9, borderRadius: 2, flex: "none",
                background: branchColour(current.name),
              }}
            />
          )}
          <select
            className="mm-input w-[280px]"
            value={selected}
            disabled={busy}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value={ALL_BRANCHES}>
              {ALL_BRANCHES_LABEL}
              {dirtyBranches.size > 0 ? "  •" : ""}
            </option>

            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((b) => {
                  const disabled = isDisabled(b, branchesWithLines);
                  return (
                    <option key={b.name} value={b.name} disabled={disabled}>
                      {b.name}
                      {b.closed ? " — closed" : !b.active ? " — inactive" : ""}
                      {disabled ? ` (no FY${fiscalYear})` : ""}
                      {dirtyBranches.has(b.name) ? "  •" : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}

            <optgroup label="Not a branch">
              <option value={NO_BRANCH}>
                {NO_BRANCH_LABEL}
                {dirtyBranches.has(NO_BRANCH) ? "  •" : ""}
              </option>
            </optgroup>
          </select>
        </label>

        {/* The dot, for the value on screen. */}
        {dirtyHere && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-brand-accent">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "#BD5A2E" }} />
            unsaved changes here
          </span>
        )}

        {/* And for branches NOT on screen — the case the chips' dots existed
            for. Switching away from unsaved work must not be silent. */}
        {dirtyElsewhere.length > 0 && (
          <span className="text-[11.5px] text-brand-accent">
            • unsaved on{" "}
            {dirtyElsewhere.map((d) => (d === NO_BRANCH ? NO_BRANCH_LABEL : d)).join(", ")}
          </span>
        )}

        {current?.closed && (
          <span className="text-[11.5px] text-brand-muted">
            {branchesWithLines.has(current.name) || current.tradedThisYear
              ? `Closed — FY${fiscalYear} stays editable because it traded this year.`
              : `Closed — no FY${fiscalYear} activity.`}
          </span>
        )}
      </div>

      {selected === ALL_BRANCHES && (
        <p className="mt-1.5 text-[11.5px] text-brand-muted">
          Showing every branch summed. <strong>Read-only</strong> — pick one branch to edit.
        </p>
      )}
    </div>
  );
}
