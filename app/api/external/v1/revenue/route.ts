import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import {
  authenticateExternal, readParams, envelope, fetchAll, scopedChannelCategories,
} from "@/lib/external-api";
import { getSyncStatus } from "@/lib/revenue-sync";

// GET /api/external/v1/revenue?fiscal_year=2026&company=ONEST
//
// Revenue GOAL and ACTUAL per channel per month.
//
// ===========================================================================
// A KEY'S SCOPE IS COARSE AND IS NOT THE PORTAL'S PERMISSION MODEL.
// ===========================================================================
// Keys are per-consumer and may be restricted to some channel categories
// (lib/external-api.ts#API_KEYS): kc-dashboard reads everything, store-ops
// reads Physical store only. That is the WHOLE of the scoping — there is no
// per-department or per-person key, and the portal's per-person visibility
// rules do NOT apply here. Do not assume a holder is constrained by them
// beyond the category list its key carries.
//
// Scope is applied IN THE QUERY below, and every total is computed from the
// rows that query returned. A scoped key is never handed a company-wide
// figure it cannot break down, because the hidden channels would then be
// recoverable by subtraction.
// ===========================================================================
//
// ===========================================================================
// REVENUE IS THE ONLY THING THIS API EXPOSES. DO NOT ADD COST ENDPOINTS.
// ===========================================================================
// /budget and /spend existed here and were DELETED before first use, on
// purpose. KC-Dashboard is open to everyone in the company, and a key carries
// no scoping (above) — so a cost endpoint would hand every reader of that
// dashboard the full cost breakdown at cat_l2 grain, salary lines included.
// The portal restricts exactly that per person: lib/spend.ts#scopeFilter
// limits a BO to their bo_scopes segments, and a person without a budget role
// does not reach the figures at all.
//
// Revenue is different in kind, not merely in sensitivity: it is a company
// top line with no per-person restriction inside the portal either, so
// publishing it withholds nothing that the portal itself protects.
//
// If a cost figure is ever wanted downstream, that is a NEW DECISION about who
// may see salary-bearing detail, and it needs per-key scoping built first —
// it is not a matter of restoring a deleted file. Read this paragraph before
// adding one back, and docs/external-api.md, which says the same.
// ===========================================================================
//
// ONLY GET IS EXPORTED. There is no write path in this file to disable — the
// other verbs are absent, so Next.js answers them 405.
//
// NULL ACTUAL STAYS NULL. It means "not yet known" and is serialised as null,
// never 0 — a zero would assert the business took nothing in a month nobody
// has lived through. See migration 040.

export async function GET(req: Request) {
  const endpoint = "/api/external/v1/revenue";
  try {
    const auth = await authenticateExternal(req, endpoint);
    if (!auth.ok) return auth.response;
    const params = readParams(req);
    if (!params.ok) return params.response;
    const { fiscalYear, company } = params;

    const admin = createAdminClient();

    // SCOPE IS APPLIED IN THE QUERY, not by trimming the response.
    //
    // A key restricted to Physical store never loads an Online channel at all,
    // so there is no filtered-out row to leak through a later edit, a debug
    // log, or a totals line someone adds without noticing. The caller cannot
    // widen this: `company` is a request parameter, `categories` is not — it
    // comes from which secret matched.
    const categories = scopedChannelCategories(auth.value);

    let chanQ = admin.from("revenue_channels")
      .select("id, bu, category, sub_category, channel, status, active")
      // ACTIVE ONLY, matching every other part of the portal.
      //
      // This query was the odd one out: it returned retired channels and
      // counted their goals in `totals`, so "Another story" — inactive, with a
      // ฿40,000 FY2026 goal — inflated the company target by exactly that,
      // and the API disagreed with the spend report on a headline figure.
      // Siplor and LOFT EYES - Tong lor came through too, at zero.
      //
      // CLOSED IS NOT INACTIVE. DCP is status='closed' and active=true: it
      // traded this year, keeps its figures, and must keep appearing. Only
      // `active` is filtered here, never `status`.
      .eq("active", true);
    if (company) chanQ = chanQ.eq("bu", company);
    if (categories) chanQ = chanQ.in("category", categories);
    const { data: channels, error: chanErr } = await chanQ;
    if (chanErr) throw chanErr;

    const ids = new Set((channels ?? []).map((c) => c.id as string));
    const goals = ids.size === 0 ? [] : await fetchAll<Record<string, unknown>>((from, to) =>
      admin.from("revenue_goals")
        .select("channel_id, month, amount, actual_amount, actual_source")
        .eq("fiscal_year", fiscalYear)
        .range(from, to));

    const byChannel = new Map<string, Record<number, { goal: number | null; actual: number | null; actual_source: string | null }>>();
    for (const g of goals) {
      const id = g.channel_id as string;
      if (!ids.has(id)) continue;
      const m = Number(g.month);
      if (!(m >= 1 && m <= 12)) continue;
      const slot = byChannel.get(id) ?? {};
      slot[m] = {
        goal: g.amount == null ? null : Number(g.amount),
        // == null, not falsy: a real actual of 0 must survive.
        actual: g.actual_amount == null ? null : Number(g.actual_amount),
        actual_source: (g.actual_source as string | null) ?? null,
      };
      byChannel.set(id, slot);
    }

    const rows = (channels ?? [])
      .sort((a, b) =>
        String(a.bu).localeCompare(String(b.bu)) ||
        String(a.category).localeCompare(String(b.category)) ||
        String(a.sub_category).localeCompare(String(b.sub_category)) ||
        String(a.channel).localeCompare(String(b.channel)))
      .map((c) => {
        const slots = byChannel.get(c.id as string) ?? {};
        const months = Array.from({ length: 12 }, (_, i) => {
          const s = slots[i + 1];
          return {
            month: i + 1,
            goal: s?.goal ?? null,
            actual: s?.actual ?? null,
            actual_source: s?.actual_source ?? null,
          };
        });
        const sum = (pick: "goal" | "actual") =>
          months.reduce<number | null>((t, m) => (m[pick] === null ? t : (t ?? 0) + (m[pick] as number)), null);
        // The last month this channel has an actual for. A consumer cannot
        // derive it safely from `months` alone: a null means "not known", and
        // scanning for the last non-null is exactly the logic that gets
        // written differently by every caller.
        const lastActualMonth = months.reduce<number | null>(
          (last, m) => (m.actual === null ? last : m.month), null);
        return {
          company: c.bu, category: c.category, sub_category: c.sub_category,
          channel: c.channel,
          // The OPTIONAL fourth hierarchy level (migration 053): sell | use |
          // closed under Specialty partners, null everywhere else. Null is
          // meaningful — "this sub-category has no status level" — not missing
          // data, so it is always present rather than omitted.
          status: (c as { status?: string | null }).status ?? null,
          // Always true now that the query filters on it. KEPT deliberately:
          // if retired channels are ever offered as an opt-in, the field is
          // already in the contract and that becomes an additive change
          // rather than a breaking one.
          active: c.active !== false,
          months, goal_total: sum("goal"), actual_total: sum("actual"),
          last_actual_month: lastActualMonth,
        };
      });

    // EVERY FIGURE HERE IS THE TOTAL OF WHAT THIS KEY CAN SEE.
    //
    // `rows` is already scoped, so these sums cannot contain a channel the
    // caller may not read. That matters more than it looks: handing a scoped
    // key a company-wide total it cannot break down would leak the hidden
    // channels by subtraction, which is the whole reason the roll-up is
    // computed from the returned rows rather than queried separately.
    const sumRows = (pick: "goal_total" | "actual_total") =>
      rows.reduce<number | null>(
        (t, r) => (r[pick] === null ? t : (t ?? 0) + (r[pick] as number)), null);

    // FRESHNESS IS ABOUT THE LAST SUCCESS, NOT THE LAST ATTEMPT.
    //
    // A sync that fails writes nothing, so the figures below are whatever the
    // last SUCCESSFUL run left. Reporting "last attempted" would let a week of
    // failures look like a fresh feed, which is the failure the budget page
    // banner exists to prevent — the same guarantee belongs here, because a
    // downstream dashboard cannot see that banner.
    const sync = await getSyncStatus();
    const ageHours = sync.lastSuccessAt
      ? Math.floor((Date.now() - new Date(sync.lastSuccessAt).getTime()) / 3_600_000)
      : null;

    return envelope({
      fiscal_year: fiscalYear,
      company: company ?? "ALL",
      currency: "THB",
      note: "actual = null means not yet known; it is never reported as 0.",
      // Stated as both an instant and an AGE: "2026-10-05T02:00Z" needs the
      // reader to know what today is, and a dashboard rendering a cached
      // response may not.
      freshness: {
        last_successful_sync_at: sync.lastSuccessAt,
        age_hours: ageHours,
        stale: sync.stale,
        // The last ATTEMPT, so a consumer can tell "nothing changed" from
        // "the last run failed and these figures are being held".
        last_attempt_at: sync.lastRunAt,
        last_attempt_status: sync.lastStatus,
        // Channels the portal has that the sheet did not on that run; their
        // figures were left unchanged and may be older than the stamp above.
        channels_not_in_sheet: sync.lastWarnings.length,
      },
      // Stated, not implied: a consumer must be able to tell that a figure is
      // partial without having to know how its key was issued.
      scope: categories
        ? { channel_categories: categories, complete: false }
        : { channel_categories: "ALL", complete: true },
      totals: { goal: sumRows("goal_total"), actual: sumRows("actual_total") },
      channels: rows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
