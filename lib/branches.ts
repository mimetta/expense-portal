import { createAdminClient } from "@/lib/supabase/admin";
import { listChannels, isClosedChannel } from "@/lib/revenue-goals";
import {
  type Branch, compareBranches, isOfferableBranch,
} from "@/lib/branches-shared";

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
export async function listBranches(fiscalYear?: number): Promise<Branch[]> {
  const channels = await listChannels(true);
  const mine = channels.filter((c) => c.bu === BRANCH_BU && c.category === "Physical store");

  // DID THIS BRANCH TRADE IN THIS YEAR?
  //
  // The closed-branch rule asks "does it already budget here", and the budget
  // page answered that from existing budget_lines alone. Branch budgeting is
  // new, so NO branch has lines yet — which made DCP unselectable for FY2026
  // despite carrying ฿53,365 of FY2026 spend and a ฿560,000 revenue goal. A
  // closed branch must stay budgetable in a year it demonstrably traded,
  // otherwise its costs can never be planned against.
  //
  // Revenue goal rows are the signal, which is the same one
  // saveRevenueGoals uses — reused rather than invented, and it is a fact
  // about the YEAR rather than about whether anyone has started budgeting.
  const traded = new Set<string>();
  if (fiscalYear) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("revenue_goals").select("channel_id").eq("fiscal_year", fiscalYear);
      const ids = new Set((data ?? []).map((r) => r.channel_id as string));
      for (const c of mine) if (ids.has(c.id)) traded.add(c.channel);
    } catch {
      // Unknown means "no special permission": the branch stays gated by its
      // closed status alone, which is the conservative direction.
    }
  }

  return mine
    .map((c) => ({
      name: c.channel,
      group: c.sub_category,
      status: c.status ?? null,
      closed: isClosedChannel(c),
      active: c.active,
      sortOrder: c.sort_order,
      tradedThisYear: traded.has(c.channel),
    }))
    // Retired rows nobody will budget: inactive AND carrying no status.
    // "LOFT EYES - Tong lor" is also a misspelling of a live branch, so
    // offering it would invite budgeting the wrong one.
    .filter(isOfferableBranch)
    // Ordered ONCE, here, so the dropdown can walk the list rather than
    // re-deriving an order the server already knows.
    .sort(compareBranches);
}
