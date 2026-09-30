import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared plumbing for the read-only outbound API (/api/external/v1/*).
//
// ===========================================================================
// THE KEY CARRIES NO SCOPING. THIS IS THE MOST IMPORTANT FACT ABOUT IT.
// ===========================================================================
// Inside the portal, who sees which figures is decided per person — a BO sees
// the segments in their bo_scopes rows, an employee sees the departments on
// their people row, and lib/spend.ts#scopeFilter enforces it on every read.
//
// NONE OF THAT APPLIES HERE. A caller holding the key sees everything this
// API exposes, for every company and any fiscal year. There is no per-key
// scope, no per-department key, and no way to issue a narrower one without
// building that mechanism first.
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

export interface ExternalCaller {
  keyLabel: string;
}

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
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("external_api_calls").insert({
      endpoint, key_label: keyLabel, status,
      ip: clientIp(req),
      query: new URL(req.url).search || null,
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
  const expected = process.env.KC_DASHBOARD_API_KEY;
  const keyLabel = "kc-dashboard";

  // Unconfigured is a refusal, not an open door. Deploying without the env var
  // must not accidentally publish finance data.
  if (!expected || expected.trim() === "") {
    await logCall(endpoint, keyLabel, 503, req);
    return fail(503, "This API is not configured on the server.");
  }

  const presented = req.headers.get(KEY_HEADER);
  if (!presented) {
    await logCall(endpoint, "unauthenticated", 401, req);
    return fail(401, `Missing ${KEY_HEADER} header.`);
  }
  if (!secretEquals(presented, expected)) {
    await logCall(endpoint, "unauthenticated", 401, req);
    return fail(401, "Invalid API key.");
  }

  // Rate limit, counted from the log so it holds across lambda instances.
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from("external_api_calls")
      .select("id", { count: "exact", head: true })
      .eq("key_label", keyLabel)
      .gte("ts", since);
    if (error) throw error;
    if ((count ?? 0) >= RATE_LIMIT) {
      await logCall(endpoint, keyLabel, 429, req);
      return fail(429, `Rate limit exceeded: ${RATE_LIMIT} requests per minute.`, {
        retry_after_seconds: Math.ceil(RATE_WINDOW_MS / 1000),
      });
    }
  } catch {
    // Cannot read the log => cannot enforce the limit => refuse. An
    // unenforceable limit is not a limit.
    await logCall(endpoint, keyLabel, 503, req);
    return fail(503, "Rate limiting is unavailable; request refused.");
  }

  await logCall(endpoint, keyLabel, 200, req);
  return ok({ keyLabel });
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
