import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared plumbing for the read-only outbound API (/api/external/v1/*).
//
// ===========================================================================
// SCOPING IS COARSE AND PER-KEY. IT IS NOT THE PORTAL'S PERMISSION MODEL.
// ===========================================================================
// Inside the portal, who sees which figures is decided per person — a BO sees
// the segments in their bo_scopes rows, an employee sees the departments on
// their people row, and lib/spend.ts#scopeFilter enforces it on every read.
//
// NONE OF THAT APPLIES HERE. A key may be restricted to some channel
// CATEGORIES (API_KEYS below) and nothing finer: there is no per-department
// key, no per-person key, and no row-level rule. Within its categories a
// holder sees every company and any fiscal year.
//
// WHICH IS WHY THE SURFACE IS REVENUE ONLY. /budget and /spend were deleted
// before first use: KC-Dashboard is open to the whole company, so an unscoped
// key would publish cost detail at cat_l2 grain, salary lines included, that
// the portal restricts per person. What keeps that data out of the dashboard
// is that no endpoint returns it — NOT that the key is limited. Adding a cost
// endpoint here re-opens a decision that was deliberately closed; see
// app/api/external/v1/revenue/route.ts and docs/external-api.md.
// ===========================================================================

export const API_VERSION = "v1";

/** Requests per key per window. Generous for a dashboard, low enough to notice a loop. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export const KEY_HEADER = "x-api-key";

/**
 * Which consumer holds which key, and HOW MUCH OF THE DATA IT MAY SEE.
 *
 * A key's label and its reach are ONE THING, declared together. Splitting them
 * — a label here, a scope somewhere else — is how a key ends up labelled
 * correctly and scoped wrongly, which is the failure that matters.
 *
 * `categories: null` means full access. A label with a category list may read
 * ONLY revenue_channels rows in those categories, and every figure it is handed
 * is computed from that subset — see scopedChannelCategories below.
 *
 * Adding a consumer is an entry here plus the env var. The secret itself is
 * never in this file, in the database, or in git.
 */
export interface KeyDefinition {
  /** The env var holding the live secret. */
  envVar: string;
  /**
   * revenue_channels.category values this key may read, or null for all.
   * Scoping is applied IN THE QUERY, never by trimming the response.
   */
  categories: string[] | null;
}

export const API_KEYS: Record<string, KeyDefinition> = {
  "kc-dashboard": { envVar: "KC_DASHBOARD_API_KEY", categories: null },
  // Store operations see their own stores and nothing else. Online revenue
  // (E-commerce, DTC-Thailand) is not theirs to read — not as rows, and not
  // inside a total they could subtract it out of.
  "store-ops": { envVar: "STORE_OPS_API_KEY", categories: ["Physical store"] },
};

/**
 * The overlap variant accepted during rotation. Logged under the SAME label,
 * so a rotating consumer's rate limit stays whole.
 */
const previousVarFor = (envVar: string) => `${envVar}_PREVIOUS`;

export interface ExternalCaller {
  keyLabel: string;
  /** null = unrestricted. Mirrors KeyDefinition.categories. */
  categories: string[] | null;
  /** True when the caller authenticated with the PREVIOUS value. */
  usedPreviousKey: boolean;
}

/** The category filter for a caller, or null when unrestricted. */
export const scopedChannelCategories = (caller: ExternalCaller) => caller.categories;

function ok<T>(value: T) { return { ok: true as const, value }; }
function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return { ok: false as const, response: NextResponse.json({ error, ...extra }, { status }) };
}

/** Length-independent constant-time compare, so the key cannot be probed by timing. */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("x-real-ip") ||
  null;

async function logCall(
  endpoint: string, keyLabel: string, status: number, req: Request,
  usedPreviousKey = false,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("external_api_calls").insert({
      endpoint, key_label: keyLabel, status,
      ip: clientIp(req),
      // The PREVIOUS key is recorded distinguishably, appended to the query
      // column so it needs no schema change. Without it "has the consumer
      // actually rotated?" is unanswerable, and an overlap window that cannot
      // be closed with confidence is one that stays open forever.
      query: `${new URL(req.url).search || ""}${usedPreviousKey ? " [previous-key]" : ""}` || null,
    });
  } catch {
    // Logging must never turn a good response into a failed one. The rate
    // limit degrades if this fails, which is the lesser problem.
  }
}

/**
 * Authenticate, rate-limit and log. Returns the caller, or a ready-made
 * response to return as-is.
 *
 * FAILS CLOSED in every direction: no env var configured, no header, wrong
 * key, or an unreadable log table all refuse the request.
 */
export async function authenticateExternal(
  req: Request, endpoint: string,
): Promise<{ ok: true; value: ExternalCaller } | { ok: false; response: NextResponse }> {
  // Every configured key, current and previous. Unconfigured labels are simply
  // absent — a missing STORE_OPS_API_KEY means store-ops cannot call, not that
  // the API is down.
  const candidates: { label: string; secret: string; previous: boolean }[] = [];
  for (const [label, def] of Object.entries(API_KEYS)) {
    const current = process.env[def.envVar];
    if (current && current.trim() !== "") {
      candidates.push({ label, secret: current, previous: false });
    }
    const prev = process.env[previousVarFor(def.envVar)];
    if (prev && prev.trim() !== "") {
      candidates.push({ label, secret: prev, previous: true });
    }
  }

  // 503 ONLY when NOTHING is configured. One consumer's variable being unset
  // is that consumer's problem, not an outage for the others.
  if (candidates.length === 0) {
    await logCall(endpoint, "unconfigured", 503, req);
    return fail(503, "This API is not configured on the server.");
  }

  const presented = req.headers.get(KEY_HEADER);
  if (!presented) {
    await logCall(endpoint, "unauthenticated", 401, req);
    return fail(401, `Missing ${KEY_HEADER} header.`);
  }

  // NO SHORT-CIRCUIT. Every candidate is compared even after one matches, so
  // the time taken does not reveal WHICH key matched, or how many are
  // configured. `matched` is assigned rather than returned from inside the
  // loop for exactly that reason — an early return here would reintroduce the
  // timing signal the constant-time compare exists to remove.
  let matched: { label: string; previous: boolean } | null = null;
  for (const c of candidates) {
    const hit = secretEquals(presented, c.secret);
    if (hit && matched === null) matched = { label: c.label, previous: c.previous };
  }

  if (matched === null) {
    // UNDER "unauthenticated", NEVER under a real label: a wrong key must not
    // consume a genuine consumer's rate-limit quota, and a burst of 401s stays
    // visually separable in the log.
    await logCall(endpoint, "unauthenticated", 401, req);
    return fail(401, "Invalid API key.");
  }

  const def = API_KEYS[matched.label];

  // Rate limit, counted from the log so it holds across lambda instances, and
  // PER LABEL so one consumer cannot exhaust another's allowance. The previous
  // key counts under the same label, so rotating does not hand a consumer a
  // second allowance.
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from("external_api_calls")
      .select("id", { count: "exact", head: true })
      .eq("key_label", matched.label)
      .gte("ts", since);
    if (error) throw error;
    if ((count ?? 0) >= RATE_LIMIT) {
      await logCall(endpoint, matched.label, 429, req, matched.previous);
      return fail(429, `Rate limit exceeded: ${RATE_LIMIT} requests per minute.`, {
        retry_after_seconds: Math.ceil(RATE_WINDOW_MS / 1000),
      });
    }
  } catch {
    // Cannot read the log => cannot enforce the limit => refuse. An
    // unenforceable limit is not a limit.
    await logCall(endpoint, matched.label, 503, req, matched.previous);
    return fail(503, "Rate limiting is unavailable; request refused.");
  }

  await logCall(endpoint, matched.label, 200, req, matched.previous);
  return ok({
    keyLabel: matched.label,
    categories: def.categories,
    usedPreviousKey: matched.previous,
  });
}

/** Fiscal year + optional company, validated the same way for every endpoint. */
export function readParams(req: Request):
  | { ok: true; fiscalYear: number; company: string | null }
  | { ok: false; response: NextResponse } {
  const url = new URL(req.url);
  const raw = url.searchParams.get("fiscal_year") ?? url.searchParams.get("year");
  const fiscalYear = Number(raw);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    return fail(400, "fiscal_year is required and must be a year between 2000 and 2100.");
  }
  const company = url.searchParams.get("company");
  if (company !== null && !["ONEST", "SV"].includes(company)) {
    return fail(400, "company must be ONEST or SV, or omitted for both.");
  }
  return { ok: true, fiscalYear, company };
}

/** Every response carries the version, so a shape change is visible to the caller. */
export function envelope(body: Record<string, unknown>) {
  return NextResponse.json(
    { version: API_VERSION, generated_at: new Date().toISOString(), ...body },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Page through a PostgREST read; the 1000-row cap bites on month-grain data. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
