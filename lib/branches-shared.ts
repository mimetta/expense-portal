// Branch values and pure helpers — NO IMPORTS, so client components can use
// them.
//
// lib/branches.ts imports lib/revenue-goals.ts, which reaches lib/auth and
// therefore next/headers. Importing that from a "use client" component breaks
// the build with "You're importing a component that needs next/headers". This
// project has hit that exact wall twice before (lib/spend's ALL_MONTHS,
// lib/budget-order-shared), and the resolution is the same each time: the pure
// values live in their own module and the server module re-exports them, so
// there is still one definition.
//
// ===========================================================================
// RETAIL ONLY, AND DELIBERATELY NOT CONFIGURABLE.
// ===========================================================================
// There is no per-department setting. A constant naming Retail is the entire
// mechanism. A settings row would invite switching this on for a department
// whose spend records no branch at all, producing a branch budget that can
// never be compared with anything. Widening it is a decision to take
// deliberately, after checking the spend side carries a branch — see migration
// 054's header.
export const BRANCH_SPLIT_DEPARTMENTS = ["Retail"] as const;

export const isBranchSplit = (department: string): boolean =>
  (BRANCH_SPLIT_DEPARTMENTS as readonly string[]).includes(department);

/** The "(no branch)" bucket. Empty string in the database; this is its UI identity. */
export const NO_BRANCH = "__none__";
export const NO_BRANCH_LABEL = "(no branch)";

/** The read-only roll-up across every branch. */
export const ALL_BRANCHES = "__all__";
export const ALL_BRANCHES_LABEL = "All branches";

export interface Branch {
  /** revenue_channels.channel — what budget_lines.branch stores. */
  name: string;
  /** Owned store | Specialty partners | Event. */
  group: string;
  /** sell | use | closed, or null where the sub-category has no status level. */
  status: string | null;
  closed: boolean;
  active: boolean;
  /**
   * Did this branch have revenue goal rows in the fiscal year being viewed?
   * A CLOSED branch that traded in the year stays budgetable there — its costs
   * have to be plannable against. Absent when the caller asked for no year.
   */
  tradedThisYear?: boolean;
}

/**
 * May this branch be given budget for this fiscal year?
 *
 * REUSES the revenue-goal rule rather than restating it: a closed branch keeps
 * every historical line and is refused only when opening a year it has no
 * lines in. `hasLinesThisYear` is the caller's answer to "does it already
 * budget in this year", exactly as saveRevenueGoals asks "does it already have
 * goal rows in this year".
 *
 * Deliberately NOT "is the year in the future": a closed branch must stay
 * correctable in the years it actually traded.
 */
export function canBudgetBranch(branch: Branch, hasLinesThisYear: boolean): boolean {
  if (!branch.closed) return true;
  return hasLinesThisYear;
}

/**
 * `budget_lines.branch` for a UI selection.
 *
 * Returns null for the (no branch) bucket; the repository layer normalises
 * null to the empty string the column actually stores (migration 055). Nothing
 * above that layer should see the empty string.
 */
export const branchColumnValue = (selection: string): string | null =>
  selection === NO_BRANCH ? null : selection;

export const branchLabel = (selection: string): string =>
  selection === NO_BRANCH ? NO_BRANCH_LABEL
    : selection === ALL_BRANCHES ? ALL_BRANCHES_LABEL
      : selection;

// ---------------------------------------------------------------------------
// COLOUR
//
// One colour per branch, used by the spend report for the swatch, the tinted
// header row and the left edge that fades down through the categories beneath
// it. Assigned from a fixed palette rather than stored, so adding a branch
// cannot leave it colourless — and derived from the NAME, not the list index,
// so a branch keeps its colour when another is added or closed above it.
const PALETTE = [
  "#1F3A2B", "#BD5A2E", "#3B6EA5", "#8E5A9E", "#2E7D52",
  "#A5673B", "#4C6B8A", "#8E2A21", "#6B7280", "#7A5A0F",
  "#5B7B5A", "#9C5B7B", "#3F7C7C", "#8A6D3B", "#55606E", "#7B5EA7",
];

/** Stable hash, so a branch's colour does not move when the list changes. */
export function branchColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * The branch colour at a given drill depth. Depth 0 is the branch header
 * itself; deeper levels fade toward the page so the edge reads as "still
 * inside this branch" without competing with the figures.
 */
export const branchEdge = (name: string, depth: number): string => {
  const alpha = [1, 0.55, 0.3, 0.18][Math.min(depth, 3)];
  return `${branchColour(name)}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
};
