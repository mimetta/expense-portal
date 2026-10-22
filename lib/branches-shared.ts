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
// A LIST, STILL NOT A SETTING.
// ===========================================================================
// This was ["Retail"], hardcoded with a note saying not to generalise it
// without first checking that the department's spend records a branch. That
// check has now been made for New Store Investment — eight of its FY2026
// requests already name a store in requests.product (Siam Discovery x5,
// Gaysorn x3, Ecotopia x2) — so it is added here deliberately.
//
// It stays a CONSTANT rather than a per-department setting, for the original
// reason: a toggle invites switching this on for a department whose spend
// records no branch at all, producing a branch budget that can never be
// compared with anything. Adding a third department should be the same
// deliberate act, with the same check, not a click.
//
// This list and migration 065's `in ('Retail', 'New Store Investment')` must
// agree. A view cannot import a TypeScript constant; the alternative was a
// lookup table, which would let the two drift silently through a data edit
// rather than loudly through a code review.
export const BRANCH_SPLIT_DEPARTMENTS = ["Retail", "New Store Investment"] as const;

export const isBranchSplit = (department: string): boolean =>
  (BRANCH_SPLIT_DEPARTMENTS as readonly string[]).includes(department);

/** The "(no branch)" bucket. Empty string in the database; this is its UI identity. */
export const NO_BRANCH = "__none__";
export const NO_BRANCH_LABEL = "(no branch)";

/**
 * SHARED — a reserved branch value meaning "belongs to every branch".
 *
 * Travel between stores, bulk consumables, uniforms. Stored as this literal
 * string in requests.product and budget_lines.branch, exactly like a branch
 * name, so every reader that groups by branch gets it for free.
 *
 * ===========================================================================
 * SHARED IS NOT A REVENUE CHANNEL AND MUST NEVER BECOME ONE.
 * ===========================================================================
 * No revenue_channels row exists for it. That is what keeps it out of the
 * revenue tree, out of goal entry, and out of the external API — all three
 * read revenue_channels, so the absence is the enforcement. Creating a row
 * "so it appears everywhere" would put a non-place in the revenue hierarchy
 * where somebody could give it a revenue goal. This is the same reasoning
 * that kept "All branch" out when that value was reconciled away.
 *
 * ===========================================================================
 * SHARED AND (NO BRANCH) ARE DIFFERENT AND MUST STAY SEPARATE.
 * ===========================================================================
 *   Shared      — a decision. Someone looked at the cost and chose it.
 *   (no branch) — an absence. Nobody recorded one.
 * They often cover the same receipts today only because Shared did not exist
 * when those were filed. Collapsing them would lose the difference between an
 * answer and a gap, and the review screen's progress strip measures exactly
 * that gap.
 */
export const SHARED_BRANCH = "Shared";
export const isSharedBranch = (v: string | null | undefined) => v === SHARED_BRANCH;

/**
 * NOT YET OPEN — signed, being fitted out, has never traded. Declared on the
 * channel, never inferred: see migration 066 for why an inference from
 * "inactive but has a revenue goal" was rejected.
 */
export const PENDING_STATUS = "pending";
export const isPendingBranch = (b: { status?: string | null; active: boolean }) =>
  !b.active && b.status === PENDING_STATUS;

/** The read-only roll-up across every branch. */
export const ALL_BRANCHES = "__all__";
export const ALL_BRANCHES_LABEL = "All branches";

// The hierarchy order, which is DELIBERATE AND NOT ALPHABETICAL. Alphabetical
// would give Event, Owned store, Specialty partners and closed, sell, use —
// both wrong. Channel order within a group lives in revenue_channels.sort_order
// (migration 060) so adding a store is a data change; only these two
// structural lists are in code, because they are not things an admin edits.
export const BRANCH_GROUP_ORDER = ["Owned store", "Specialty partners", "Event"];
export const BRANCH_STATUS_ORDER = ["sell", "use", "closed"];

const orderIndex = (list: string[], v: string | null) => {
  const i = list.indexOf(v ?? "");
  // Anything unlisted sorts after everything listed rather than before, so a
  // new sub-category appears at the end instead of silently jumping the queue.
  return i === -1 ? list.length : i;
};

/** Group → status → sort_order → name, per the agreed hierarchy. */
export function compareBranches(a: Branch, b: Branch): number {
  return orderIndex(BRANCH_GROUP_ORDER, a.group) - orderIndex(BRANCH_GROUP_ORDER, b.group)
    || orderIndex(BRANCH_STATUS_ORDER, a.status) - orderIndex(BRANCH_STATUS_ORDER, b.status)
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || a.name.localeCompare(b.name);
}

/**
 * Branches worth offering. An INACTIVE channel with NO status is excluded
 * entirely — Another story, Siplor, LOFT EYES - Tong lor are retired rows
 * nobody will budget, and the last is a misspelling of a live branch. A closed
 * branch is NOT excluded: it is still shown, marked, and selectable in a year
 * it traded.
 */
export const isOfferableBranch = (b: Branch) =>
  b.active || b.closed || isPendingBranch(b);

export interface Branch {
  /** revenue_channels.channel — what budget_lines.branch stores. */
  name: string;
  /** Owned store | Specialty partners | Event. */
  group: string;
  /** sell | use | closed, or null where the sub-category has no status level. */
  status: string | null;
  closed: boolean;
  active: boolean;
  /** revenue_channels.sort_order — the within-group order, held as data. */
  sortOrder?: number;
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
 * The branch list differs by department, and the difference is real.
 *
 *   Retail — a store you can spend against is one that trades: active, or
 *            closed in a year it traded.
 *   New Store Investment — FITTING OUT HAPPENS BEFORE TRADING. A signed site
 *            with no opening date is exactly what NSI spends on, so pending
 *            channels are offered here and nowhere else.
 *
 * A retired site (inactive, no status) appears in neither: Siplor was
 * cancelled and must not be selectable.
 */
export function branchesForDepartment(all: Branch[], department: string): Branch[] {
  const nsi = department === "New Store Investment";
  return all.filter((b) => {
    if (b.active) return true;
    if (isPendingBranch(b)) return nsi;
    return false;                 // inactive, not pending => retired
  });
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

/** Shared gets a colour too, so it reads as a bucket rather than a gap. */
export const SHARED_COLOUR = "#6B7280";

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
