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
  /** The GOAL per month. null = not yet open. */
  months: (number | null)[];
  /**
   * The ACTUAL per month. null = not yet known, and it must stay null all the
   * way up: a parent month is null only when every descendant is null, the
   * same rule `months` already follows. Never coerce to 0 — see migration 040.
   */
  actuals: (number | null)[];
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
function rollUp(children: RevenueNode[], pick: "months" | "actuals" = "months"): (number | null)[] {
  return Array.from({ length: MONTH_COUNT }, (_, m) => {
    let sum: number | null = null;
    for (const c of children) {
      const v = c[pick][m];
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
): Promise<{ tree: RevenueNode; channels: RevenueChannel[]; syncedAt: string | null }> {
  const admin = createAdminClient();
  const all = await listChannels();
  const channels = bu ? all.filter((c) => c.bu === bu) : all;

  const goals = new Map<string, (number | null)[]>();
  const actuals = new Map<string, (number | null)[]>();
  let syncedAt: string | null = null;
  if (channels.length > 0) {
    const { data, error } = await admin
      .from("revenue_goals")
      .select("channel_id, month, amount, actual_amount, actual_synced_at")
      .eq("fiscal_year", fiscalYear);
    if (error) throw error;
    for (const g of data ?? []) {
      const id = g.channel_id as string;
      let arr = goals.get(id);
      if (!arr) { arr = nulls(); goals.set(id, arr); }
      let act = actuals.get(id);
      if (!act) { act = nulls(); actuals.set(id, act); }
      const m = Number(g.month);
      if (m >= 1 && m <= MONTH_COUNT) {
        arr[m - 1] = Number(g.amount);
        // == null, not a truthiness test: 0 is a real actual of zero revenue
        // and must survive, while null stays null.
        act[m - 1] = g.actual_amount == null ? null : Number(g.actual_amount);
      }
      const ts = g.actual_synced_at as string | null;
      if (ts && (!syncedAt || ts > syncedAt)) syncedAt = ts;
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
          actuals: actuals.get(c.id) ?? nulls(),
          channelId: c.id,
          active: c.active,
          children: [],
        }));
        subNodes.push({
          key: `${buName}|${catName}|${subName}`,
          level: "sub_category",
          label: subName,
          months: rollUp(chanNodes),
          actuals: rollUp(chanNodes, "actuals"),
          children: chanNodes,
        });
      }
      catNodes.push({
        key: `${buName}|${catName}`,
        level: "category",
        label: catName,
        months: rollUp(subNodes),
        actuals: rollUp(subNodes, "actuals"),
        children: subNodes,
      });
    }
    buNodes.push({
      key: buName,
      level: "bu",
      label: buName,
      months: rollUp(catNodes),
      actuals: rollUp(catNodes, "actuals"),
      children: catNodes,
    });
  }
  buNodes.sort((a, b) => a.label.localeCompare(b.label));

  return {
    syncedAt,
    tree: {
      key: "__total__",
      level: "total",
      label: "Revenue goal",
      months: rollUp(buNodes),
      actuals: rollUp(buNodes, "actuals"),
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

export interface ActualEntry {
  channelId: string;
  month: number;
  /** null CLEARS the actual back to "not yet known" — it does not store 0. */
  actual: number | null;
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

/**
 * Writes ACTUALS at channel level. CEO/SUPERADMIN only — the same gate as
 * goals, per migration 040.
 *
 * Unlike saveRevenueGoals, a null here does NOT delete the row: the goal on
 * that row must survive. It nulls the three actual columns instead, putting
 * the month back to "not yet known".
 *
 * A row is created if the month has no goal yet, so an actual can be recorded
 * for a month nobody planned. `amount` then takes its column default of 0,
 * which is the goal's own "deliberate target" meaning — not a claim about the
 * actual, which is stored separately.
 *
 * `source` defaults to 'manual' because that is the only caller today. The
 * Google Sheets sync will pass 'sheet', and the column exists so that sync can
 * never silently overwrite a hand-entered figure without it being visible.
 */
export async function saveRevenueActuals(
  fiscalYear: number,
  entries: ActualEntry[],
  viewer: CurrentUser,
  source: "sheet" | "manual" = "manual",
): Promise<{ written: number; cleared: number }> {
  assertCanEditRevenueGoals(viewer);
  if (entries.length === 0) return { written: 0, cleared: 0 };

  const admin = createAdminClient();
  const valid = await listChannels(true);
  const known = new Set(valid.map((c) => c.id));
  const bad = entries.filter((e) => !known.has(e.channelId));
  if (bad.length > 0) throw new ForbiddenError(`${bad.length} actual(s) name an unknown channel.`);

  const now = new Date().toISOString();
  const toWrite = entries.filter((e) => e.actual !== null);
  const toClear = entries.filter((e) => e.actual === null);

  for (let i = 0; i < toWrite.length; i += 500) {
    const { error } = await admin.from("revenue_goals").upsert(
      toWrite.slice(i, i + 500).map((e) => ({
        channel_id: e.channelId,
        fiscal_year: fiscalYear,
        month: e.month,
        actual_amount: e.actual,
        actual_source: source,
        actual_synced_at: now,
        updated_by: viewer.email,
        updated_at: now,
      })),
      // Same arbiter as goals. On conflict this updates only the columns
      // named above, so an existing GOAL on the row is preserved.
      { onConflict: "channel_id,fiscal_year,month" },
    );
    if (error) throw error;
  }
  for (const e of toClear) {
    const { error } = await admin
      .from("revenue_goals")
      .update({ actual_amount: null, actual_source: null, actual_synced_at: null, updated_by: viewer.email, updated_at: now })
      .eq("channel_id", e.channelId)
      .eq("fiscal_year", fiscalYear)
      .eq("month", e.month);
    if (error) throw error;
  }

  await logAudit(viewer.email, null, "REVENUE_ACTUALS_SAVED", {
    fiscal_year: fiscalYear, written: toWrite.length, cleared: toClear.length, source,
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
