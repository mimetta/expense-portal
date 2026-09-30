import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { authenticateExternal, readParams, envelope, fetchAll } from "@/lib/external-api";

// GET /api/external/v1/revenue?fiscal_year=2026&company=ONEST
//
// Revenue GOAL and ACTUAL per channel per month.
//
// ===========================================================================
// THE KEY CARRIES NO SCOPING. A caller holding it sees every company and
// every channel. The portal's per-person visibility rules do NOT apply here —
// see lib/external-api.ts for the full statement. Do not assume anything
// downstream of this key is constrained by them.
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

    let chanQ = admin.from("revenue_channels")
      .select("id, bu, category, sub_category, channel, active");
    if (company) chanQ = chanQ.eq("bu", company);
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
        return {
          company: c.bu, category: c.category, sub_category: c.sub_category,
          channel: c.channel, active: c.active !== false,
          months, goal_total: sum("goal"), actual_total: sum("actual"),
        };
      });

    return envelope({
      fiscal_year: fiscalYear,
      company: company ?? "ALL",
      currency: "THB",
      note: "actual = null means not yet known; it is never reported as 0.",
      channels: rows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
