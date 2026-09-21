import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/types/database";

// Revenue goals: the denominator a budget is planned against.
// Server-side only — holds the service-role key.
//
// NOT versioned, NOT approved: a write takes effect immediately. See
// migration 033's header for why this deliberately does not follow
// budget_revisions' DRAFT -> SUBMITTED -> APPROVED workflow.

export interface RevenueChannel {
  id: string;
  bu: string;
  category: string;
  sub_category: string;
  channel: string;
  sort_order: number;
  active: boolean;
}

/**
 * A row in the revenue tree. `months[i]` is null where nothing is set —
 * "not yet open" — and a number where a goal exists, including a deliberate
 * zero. The distinction survives all the way up: a parent month is null only
 * when every descendant is null.
 */
export interface RevenueNode {
  key: string;
  level: "total" | "bu" | "category" | "sub_category" | "channel";
  label: string;
  months: (number | null)[];
  /** Channel rows only — the id goals are written against. */
  channelId?: string;
  active?: boolean;
  children: RevenueNode[];
}

export const MONTH_COUNT = 12;
const nulls = (): (number | null)[] => Array.from({ length: MONTH_COUNT }, () => null);

/** Only a CEO or SUPERADMIN may set goals. A BO reads them and plans against them. */
export function canEditRevenueGoals(viewer: CurrentUser): boolean {
  return isSuperadmin(viewer) || hasRole(viewer, "CEO");
}

export function assertCanEditRevenueGoals(viewer: CurrentUser): void {
  if (!canEditRevenueGoals(viewer)) {
    throw new ForbiddenError(
      "Only a CEO or admin can set revenue goals. Budget owners plan against them.",
    );
  }
}

export async function listChannels(includeInactive = false): Promise<RevenueChannel[]> {
  const admin = createAdminClient();
  let q = admin
    .from("revenue_channels")
    .select("id, bu, category, sub_category, channel, sort_order, active")
    .order("bu")
    .order("category")
    .order("sub_category")
    .order("sort_order")
    .order("channel");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RevenueChannel[];
}

/**
 * Sum children into a parent month, preserving "not yet open". Returns null
 * for a month only when NO child has a figure there — so a sub-category whose
 * single store opens in September reads as an em dash through August, rather
 * than as a target of zero that was missed.
 */
function rollUp(children: RevenueNode[]): (number | null)[] {
  return Array.from({ length: MONTH_COUNT }, (_, m) => {
    let sum: number | null = null;
    for (const c of children) {
      const v = c.months[m];
      if (v === null || v === undefined) continue;
      sum = (sum ?? 0) + v;
    }
    return sum;
  });
}

/**
 * The whole tree for a fiscal year: company total > BU > category >
 * sub-category > channel. Every level above `channel` is a sum; there is
 * nowhere to store one independently, by design.
 *
 * `bu` filters to a single business unit. Passing nothing keeps both, and the
 * company total row is then the combined denominator the mockup specifies for
 * the "Both" filter.
 */
export async function getRevenueTree(
  fiscalYear: number,
  bu?: string,
): Promise<{ tree: RevenueNode; channels: RevenueChannel[] }> {
  const admin = createAdminClient();
  const all = await listChannels();
  const channels = bu ? all.filter((c) => c.bu === bu) : all;

  const goals = new Map<string, (number | null)[]>();
  if (channels.length > 0) {
    const { data, error } = await admin
      .from("revenue_goals")
      .select("channel_id, month, amount")
      .eq("fiscal_year", fiscalYear);
    if (error) throw error;
    for (const g of data ?? []) {
      const id = g.channel_id as string;
      let arr = goals.get(id);
      if (!arr) { arr = nulls(); goals.set(id, arr); }
      const m = Number(g.month);
      if (m >= 1 && m <= MONTH_COUNT) arr[m - 1] = Number(g.amount);
    }
  }

  // bu -> category -> sub_category -> channel[]
  const byBu = new Map<string, Map<string, Map<string, RevenueChannel[]>>>();
  for (const c of channels) {
    if (!byBu.has(c.bu)) byBu.set(c.bu, new Map());
    const cats = byBu.get(c.bu)!;
    if (!cats.has(c.category)) cats.set(c.category, new Map());
    const subs = cats.get(c.category)!;
    if (!subs.has(c.sub_category)) subs.set(c.sub_category, []);
    subs.get(c.sub_category)!.push(c);
  }

  const buNodes: RevenueNode[] = [];
  // Array.from, not for-of over the Map directly — this tsconfig targets below
  // es2015 for iteration (same constraint as lib/budget-revisions.ts).
  for (const [buName, cats] of Array.from(byBu.entries())) {
    const catNodes: RevenueNode[] = [];
    for (const [catName, subs] of Array.from(cats.entries())) {
      const subNodes: RevenueNode[] = [];
      for (const [subName, chans] of Array.from(subs.entries())) {
        const chanNodes: RevenueNode[] = chans.map((c: RevenueChannel) => ({
          key: c.id,
          level: "channel" as const,
          label: c.channel,
          months: goals.get(c.id) ?? nulls(),
          channelId: c.id,
          active: c.active,
          children: [],
        }));
        subNodes.push({
          key: `${buName}|${catName}|${subName}`,
          level: "sub_category",
          label: subName,
          months: rollUp(chanNodes),
          children: chanNodes,
        });
      }
      catNodes.push({
        key: `${buName}|${catName}`,
        level: "category",
        label: catName,
        months: rollUp(subNodes),
        children: subNodes,
      });
    }
    buNodes.push({
      key: buName,
      level: "bu",
      label: buName,
      months: rollUp(catNodes),
      children: catNodes,
    });
  }
  buNodes.sort((a, b) => a.label.localeCompare(b.label));

  return {
    tree: {
      key: "__total__",
      level: "total",
      label: "Revenue goal",
      months: rollUp(buNodes),
      children: buNodes,
    },
    channels,
  };
}

export interface GoalEntry {
  channelId: string;
  month: number;
  /** null deletes the row — restoring "not yet open" rather than storing 0. */
  amount: number | null;
}

/**
 * Writes goals at channel level. CEO/SUPERADMIN only.
 *
 * A null amount DELETES the row rather than storing zero, because the two mean
 * different things here and the UI has to be able to take a figure back out.
 */
export async function saveRevenueGoals(
  fiscalYear: number,
  entries: GoalEntry[],
  viewer: CurrentUser,
): Promise<{ written: number; cleared: number }> {
  assertCanEditRevenueGoals(viewer);
  if (entries.length === 0) return { written: 0, cleared: 0 };

  const admin = createAdminClient();
  const valid = await listChannels(true);
  const known = new Set(valid.map((c) => c.id));
  const bad = entries.filter((e) => !known.has(e.channelId));
  if (bad.length > 0) throw new ForbiddenError(`${bad.length} goal(s) name an unknown channel.`);

  const toWrite = entries.filter((e) => e.amount !== null);
  const toClear = entries.filter((e) => e.amount === null);

  for (let i = 0; i < toWrite.length; i += 500) {
    const { error } = await admin.from("revenue_goals").upsert(
      toWrite.slice(i, i + 500).map((e) => ({
        channel_id: e.channelId,
        fiscal_year: fiscalYear,
        month: e.month,
        amount: e.amount,
        updated_by: viewer.email,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "channel_id,fiscal_year,month" },
    );
    if (error) throw error;
  }
  for (const e of toClear) {
    const { error } = await admin
      .from("revenue_goals")
      .delete()
      .eq("channel_id", e.channelId)
      .eq("fiscal_year", fiscalYear)
      .eq("month", e.month);
    if (error) throw error;
  }

  await logAudit(viewer.email, null, "REVENUE_GOALS_SAVED", {
    fiscal_year: fiscalYear,
    written: toWrite.length,
    cleared: toClear.length,
  });
  return { written: toWrite.length, cleared: toClear.length };
}

/** Adds a channel — and with it, implicitly, its category/sub-category. */
export async function addChannel(
  input: { bu: string; category: string; sub_category: string; channel: string },
  viewer: CurrentUser,
): Promise<RevenueChannel> {
  assertCanEditRevenueGoals(viewer);
  const fields = ["bu", "category", "sub_category", "channel"] as const;
  for (const f of fields) {
    if (!String(input[f] ?? "").trim()) throw new ForbiddenError(`${f} is required.`);
  }
  const admin = createAdminClient();
  // Sort after whatever is already in that sub-category.
  const { data: siblings } = await admin
    .from("revenue_channels")
    .select("sort_order")
    .eq("bu", input.bu)
    .eq("category", input.category)
    .eq("sub_category", input.sub_category)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sort_order = ((siblings?.[0]?.sort_order as number) ?? 0) + 10;

  const { data, error } = await admin
    .from("revenue_channels")
    .insert({
      bu: input.bu.trim(),
      category: input.category.trim(),
      sub_category: input.sub_category.trim(),
      channel: input.channel.trim(),
      sort_order,
    })
    .select("*")
    .single();
  if (error) throw error;
  await logAudit(viewer.email, null, "REVENUE_CHANNEL_ADDED", { ...input });
  return data as RevenueChannel;
}

/**
 * Closing a store deactivates it. There is no delete: revenue_goals cascades
 * from revenue_channels, so removing a row would take its history with it and
 * silently change last year's comparison.
 */
export async function setChannelActive(
  channelId: string,
  active: boolean,
  viewer: CurrentUser,
): Promise<void> {
  assertCanEditRevenueGoals(viewer);
  const admin = createAdminClient();
  const { error } = await admin
    .from("revenue_channels")
    .update({ active })
    .eq("id", channelId);
  if (error) throw error;
  await logAudit(viewer.email, null, active ? "REVENUE_CHANNEL_REOPENED" : "REVENUE_CHANNEL_CLOSED", {
    channel_id: channelId,
  });
}
