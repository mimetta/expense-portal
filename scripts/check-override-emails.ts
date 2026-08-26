// Read-only sanity check — writes nothing, ever. Run any time, no --apply flag.
//
// Step 2 of the use_for_company backfill plan (see CLAUDE.md "Legacy requests
// import script" and the report in scripts/report-missing-use-for-company.ts):
// before trusting a hand-typed list of "this requester's company differs from
// their bu" overrides, verify each email actually appears among the requests
// missing use_for_company, and check whether their current `bu` values match
// what was claimed. Catches typos (e.g. a wrong username) and catches cases
// where the requester's rows are already a mix of both BUs rather than
// uniformly "wrong", so the override needs to be scoped more carefully than
// a blanket per-email swap.
//
// Run:
//   npx tsx scripts/check-override-emails.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
// .env.local, same convention as scripts/migrate-from-sheets.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — checked process.env and .env.local.",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Exactly as given by Darling — one entry per person (some people have more
// than one email on file, e.g. noppatsorn.o@ / noppatsorn.k@ are confirmed
// to be the same person, Noon Noppatsorn), the company she says these should
// be backfilled to, and the bu she says currently shows (just for the sanity
// check message; the actual check reads live bu values, not this claim).
const OVERRIDES: { emails: string[]; targetCompany: string; claimedCurrentBu: string }[] = [
  { emails: ["thannaporn.s@mimetta.co"], targetCompany: "SV", claimedCurrentBu: "ONEST" },
  { emails: ["noppatsorn.o@mimetta.co", "noppatsorn.k@mimetta.co"], targetCompany: "SV", claimedCurrentBu: "ONEST" },
  // Note: this person's email on file is @plantae.co, not @mimetta.co — the
  // earlier report's top-requester breakdown showed "First Wacharanan
  // <wacharanan.j@plantae.co>", which is why wacharanan.j@mimetta.co matched
  // nothing.
  { emails: ["wacharanan.j@plantae.co"], targetCompany: "ONEST", claimedCurrentBu: "SV" },
  { emails: ["sitanun.n@mimetta.co"], targetCompany: "ONEST", claimedCurrentBu: "SV" },
  { emails: ["pinprai.t@mimetta.co"], targetCompany: "SV", claimedCurrentBu: "ONEST" },
  { emails: ["roengchai.s@mimetta.co"], targetCompany: "SV", claimedCurrentBu: "ONEST" },
  { emails: ["siriwan.b@mimetta.co"], targetCompany: "ONEST", claimedCurrentBu: "SV" },
  { emails: ["tunyamon.p@mimetta.co"], targetCompany: "SV", claimedCurrentBu: "ONEST" },
];

interface Row {
  request_id: string;
  bu: string;
  department: string | null;
  requester_name: string | null;
  requester_email: string | null;
}

async function main() {
  console.log("Fetching requests where use_for_company is null...\n");

  const { data, error } = await admin
    .from("requests")
    .select("request_id, bu, department, requester_name, requester_email")
    .is("use_for_company", null);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  const allEmails = OVERRIDES.flatMap((o) => o.emails);

  // Also check ALL requests (not just the missing-use_for_company ones) for
  // each email, so a zero-match email can be distinguished as "doesn't exist
  // in this app at all" vs "exists, but has no missing-use_for_company rows".
  const { data: allForEmails, error: allErr } = await admin
    .from("requests")
    .select("requester_email, requester_name")
    .in("requester_email", allEmails);
  if (allErr) {
    console.error("Query failed:", allErr.message);
    process.exit(1);
  }
  const emailExistsAnywhere = new Set((allForEmails ?? []).map((r: any) => r.requester_email));

  for (const o of OVERRIDES) {
    const matches = rows.filter((r) => r.requester_email && o.emails.includes(r.requester_email));
    const buCounts = new Map<string, number>();
    for (const m of matches) buCounts.set(m.bu, (buCounts.get(m.bu) ?? 0) + 1);
    const buSummary = Array.from(buCounts.entries())
      .map(([bu, count]) => `${bu}=${count}`)
      .join(", ") || "(none)";

    console.log(`--- ${o.emails.join(" / ")} → override to ${o.targetCompany} ---`);

    const missingEmails = o.emails.filter((e) => !emailExistsAnywhere.has(e));
    if (missingEmails.length > 0) {
      console.log(`  ⚠️  These email(s) don't appear ANYWHERE in requests — check for typos: ${missingEmails.join(", ")}`);
    }

    if (matches.length === 0) {
      console.log(`  0 rows with missing use_for_company for ${o.emails.join(" / ")}.`);
      continue;
    }
    console.log(`  ${matches.length} rows found (across ${o.emails.length} email alias(es)). Current bu breakdown: ${buSummary}`);
    const names = Array.from(new Set(matches.map((m) => m.requester_name ?? "(no name)")));
    console.log(`  Name(s) on file: ${names.join(", ")}`);
    const mismatchCount = matches.filter((m) => m.bu !== o.claimedCurrentBu).length;
    if (mismatchCount > 0) {
      console.log(
        `  Note: ${mismatchCount} of ${matches.length} rows have bu != "${o.claimedCurrentBu}" as you described (mixed bu for this person) — override will still apply to ALL their rows regardless of current bu, unless you want it scoped differently.`,
      );
    }
    console.log("");
  }
}

main();
