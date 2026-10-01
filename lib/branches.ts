import { listChannels, isClosedChannel } from "@/lib/revenue-goals";
import { type Branch } from "@/lib/branches-shared";

// Branches, for Retail budgeting. SERVER ONLY — this reaches revenue_goals and
// therefore next/headers. Client components import lib/branches-shared.
//
// ===========================================================================
// A BRANCH IS A REVENUE CHANNEL. THERE IS NO SECOND LIST.
// ===========================================================================
// Retail branches ARE the ONEST Physical store rows of revenue_channels —
// Owned store, Specialty partners (sell/use/closed) and Event. Adding a branch
// is adding a channel; closing one is closing a channel. A parallel branches
// table would immediately drift from the channel list revenue is already
// reported against, and comparing against that revenue is the whole point.

export * from "@/lib/branches-shared";

/** The company whose Physical store channels are the branch list. */
const BRANCH_BU = "ONEST";

/**
 * The branch list, in the order the budget page shows it.
 *
 * Inactive channels are included: a branch that traded earlier in the year
 * still has lines to read. They are marked rather than hidden, the same way
 * the revenue grid treats a closed channel.
 */
export async function listBranches(): Promise<Branch[]> {
  const channels = await listChannels(true);
  return channels
    .filter((c) => c.bu === BRANCH_BU && c.category === "Physical store")
    .map((c) => ({
      name: c.channel,
      group: c.sub_category,
      status: c.status ?? null,
      closed: isClosedChannel(c),
      active: c.active,
    }));
}
