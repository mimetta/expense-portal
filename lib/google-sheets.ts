import { createSign } from "node:crypto";

// Minimal read-only Google Sheets client, service-account authenticated.
//
// WHY NOT `googleapis`. That package is tens of megabytes and carries every
// Google API; this needs one GET and one token exchange. The repo has made the
// same call before — a hand-rolled .env parser rather than dotenv, a hand-drawn
// SVG rather than an icon library. RS256 JWT signing is in node:crypto already.
//
// ===========================================================================
// THE PRIVATE KEY IS NEVER LOGGED, RETURNED OR PUT IN AN ERROR MESSAGE.
// ===========================================================================
// Every throw below names the VARIABLE, never its value. If you add a branch
// here, keep that: an error string from this file can reach a Discord channel
// and a notification row, and a leaked key would be unrecoverable from either.
// The key is also never serialised into the route's JSON response — see
// app/api/revenue-sync/route.ts, which returns counts and warnings only.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export class SheetConfigError extends Error {}
export class SheetAccessError extends Error {}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Vercel's env UI stores the PEM with literal backslash-n rather than real
 * newlines, which is the single most common reason this fails on a first
 * deploy. Accept both; a PEM that is still wrong fails at signing, naming the
 * variable and not its contents.
 */
function readPrivateKey(): string {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw || !raw.trim()) throw new SheetConfigError("GOOGLE_PRIVATE_KEY is not set.");
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  if (!key.includes("BEGIN") || !key.includes("PRIVATE KEY")) {
    throw new SheetConfigError("GOOGLE_PRIVATE_KEY does not look like a PEM private key.");
  }
  return key;
}

/** Service-account JWT -> OAuth access token. */
async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email || !email.trim()) throw new SheetConfigError("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set.");
  const key = readPrivateKey();

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    signature = b64url(signer.sign(key));
  } catch {
    // Deliberately swallowing the original: node's signing errors can echo key
    // material back in the message.
    throw new SheetConfigError("GOOGLE_PRIVATE_KEY could not be used to sign — check it is the full PEM, newlines included.");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Google's error body names the account and the fault, never the key.
    throw new SheetAccessError(`Google rejected the service-account token request (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new SheetAccessError("Google returned no access_token.");
  return json.access_token;
}

/** The tab names present in the workbook, for a "which tabs exist" error. */
export async function listTabs(spreadsheetId: string, token: string): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SheetAccessError(`Could not read the workbook (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (json.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

/**
 * Read one tab as a table of strings.
 *
 * UNFORMATTED_VALUE + a serial date option would hand back raw numbers; this
 * asks for FORMATTED_VALUE instead so the cells arrive exactly as the CSV
 * export produced them, which is what the shared parser was validated against.
 * Reusing the validated path matters more here than saving a parse.
 *
 * Google omits trailing empty cells, so rows come back ragged — the parser
 * reads `cells[c] ?? ""` throughout and is fine with that.
 */
export async function readTab(
  spreadsheetId: string, tabName: string, token: string,
): Promise<string[][] | null> {
  // A!1:ZZ is wide enough for the product blocks to the right; the parser
  // ignores everything past column M.
  const range = `${tabName}!A1:ZZ500`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
    + `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 400) return null;   // Google's answer for "no such tab"
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SheetAccessError(`Could not read tab "${tabName}" (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

export interface FetchedTab { rows: string[][]; tabName: string }

/**
 * Fetch one named tab, failing loudly if it is absent.
 *
 * A MISSING TAB IS NEVER SUBSTITUTED. Falling back to "the newest tab" or "the
 * first one that looks right" is how a sync ends up importing 2025 into 2026
 * and nobody notices for a month. The error names the tab wanted and the tabs
 * that exist, which is what someone actually needs to fix it.
 */
export async function fetchRevenueTab(fiscalYear: number, tabName: string): Promise<FetchedTab> {
  const spreadsheetId = process.env.REVENUE_SHEET_ID;
  if (!spreadsheetId || !spreadsheetId.trim()) throw new SheetConfigError("REVENUE_SHEET_ID is not set.");

  const token = await getAccessToken();
  const rows = await readTab(spreadsheetId, tabName, token);
  if (rows === null) {
    const tabs = await listTabs(spreadsheetId, token).catch(() => []);
    throw new SheetAccessError(
      `Tab "${tabName}" not found for FY${fiscalYear}.`
      + (tabs.length ? ` Tabs present: ${tabs.join(", ")}.` : "")
      + " Refusing to read a different tab.",
    );
  }
  return { rows, tabName };
}
