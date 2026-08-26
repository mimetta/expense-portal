// Step 3 of the use_for_company backfill plan (see CLAUDE.md "Legacy requests
// import script" and scripts/report-missing-use-for-company.ts /
// scripts/check-override-emails.ts for how this list was built and verified).
//
// Dry-run by default (reports what it would change, writes nothing); pass
// --apply to actually write. Same convention as every other script in this
// repo (scripts/migrate-from-sheets.ts, scripts/import-expensedb-requests.ts).
//
// Backfills requests.use_for_company for every request where it's currently
// null:
//   - Default: use_for_company = the request's own `bu` (companies.bu is a
//     unique 2-row table, 'SV' / 'ONEST' — the exact same domain as
//     requests.bu — so this is a same-type copy, not a guess).
//   - Override: for the 8 people below (confirmed via
//     scripts/check-override-emails.ts — email aliases resolved, one email
//     typo fixed from @mimetta.co to the real @plantae.co domain), EVERY one
//     of their rows gets their stated company regardless of what `bu` says,
//     since Darling confirmed these specific people's expenses are billed to
//     a different company than their own BU, consistently, not just on the
//     rows that currently look "wrong".
//
// Only ever touches rows where use_for_company IS NULL — never overwrites an
// already-set value. Re-running after --apply is a no-op (0 rows match).
//
// Run:
//   npx tsx scripts/backfill-use-for-company.ts              (dry run)
//   npx tsx scripts/backfill-use-for-company.ts --apply       (writes)
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

const APPLY = process.argv.includes("--apply");

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

// Verified against the live data via scripts/check-override-emails.ts —
// every email below has confirmed matches, no typos remaining.
const OVERRIDES: { emails: string[]; targetCompany: "SV" | "ONEST"; label: string }[] = [
  { emails: ["thannaporn.s@mimetta.co"], targetCompany: "SV", label: "Klao Thannaporn" },
  { emails: ["noppatsorn.o@mimetta.co", "noppatsorn.k@mimetta.co"], targetCompany: "SV", label: "Noon Noppatsorn" },
  { emails: ["wacharanan.j@plantae.co"], targetCompany: "ONEST", label: "Wacharanan Jamkrajang / First Wacharanan" },
  { emails: ["sitanun.n@mimetta.co"], targetCompany: "ONEST", label: "Sitanun / Mew Sitanun" },
  { emails: ["pinprai.t@mimetta.co"], targetCompany: "SV", label: "Pin Pinprai" },
  { emails: ["roengchai.s@mimetta.co"], targetCompany: "SV", label: "Big Roengchai" },
  { emails: ["siriwan.b@mimetta.co"], targetCompany: "ONEST", label: "Siriwan Bunprasan / Kwang Siriwan" },
  { emails: ["tunyamon.p@mimetta.co"], targetCompany: "SV", label: "Nueng Tunyamon" },
];

// email -> target company, flattened for O(1) lookup.
const OVERRIDE_BY_EMAIL = new Map<string, "SV" | "ONEST">();
for (const o of OVERRIDES) {
  for (const e of o.emails) OVERRIDE_BY_EMAIL.set(e, o.targetCompany);
}

interface Row {
  request_id: string;
  bu: string;
  requester_email: string | null;
  requester_name: string | null;
}

async function main() {
  console.log(APPLY ? "APPLY MODE — this will write to the database.\n" : "DRY RUN — no writes will be made. Pass --apply to write for real.\n");
  console.log("Fetching requests where use_for_company is null...\n");

  const { data, error } = await admin
    .from("requests")
    .select("request_id, bu, requester_email, requester_name")
    .is("use_for_company", null);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  if (rows.length === 0) {
    console.log("Nothing to backfill — every request already has use_for_company set.");
    return;
  }

  const planned = rows.map((r) => {
    const override = r.requester_email ? OVERRIDE_BY_EMAIL.get(r.requester_email) : undefined;
    return {
      request_id: r.request_id,
      requester_name: r.requester_name,
      requester_email: r.requester_email,
      bu: r.bu,
      target: override ?? r.bu,
      source: override ? "override" : "default (= bu)",
    };
  });

  const overrideRows = planned.filter((p) => p.source === "override");
  const defaultRows = planned.filter((p) => p.source === "default (= bu)");

  console.log(`Total requests to backfill: ${planned.length}`);
  console.log(`  Via person override: ${overrideRows.length}`);
  console.log(`  Via default (use_for_company = bu): ${defaultRows.length}\n`);

  console.log("--- Override breakdown by person ---");
  for (const o of OVERRIDES) {
    const count = overrideRows.filter((p) => p.requester_email && o.emails.includes(p.requester_email)).length;
    console.log(`  ${o.label} (${o.emails.join(" / ")}) -> ${o.targetCompany}: ${count} rows`);
  }

  console.log("\n--- Default breakdown by target company ---");
  const svCount = defaultRows.filter((p) => p.target === "SV").length;
  const onestCount = defaultRows.filter((p) => p.target === "ONEST").length;
  const otherCount = defaultRows.length - svCount - onestCount;
  console.log(`  SV: ${svCount}`);
  console.log(`  ONEST: ${onestCount}`);
  if (otherCount > 0) {
    console.log(`  ⚠️  Other/unexpected bu value: ${otherCount} rows — inspect before applying:`);
    for (const p of defaultRows) {
      if (p.target !== "SV" && p.target !== "ONEST") {
        console.log(`    ${p.request_id}  bu="${p.bu}"  ${p.requester_name ?? "-"} <${p.requester_email ?? "-"}>`);
      }
    }
  }

  console.log("\n--- Sample of planned changes (first 20) ---");
  for (const p of planned.slice(0, 20)) {
    console.log(`  ${p.request_id}  bu=${p.bu}  ->  use_for_company=${p.target}  [${p.source}]  ${p.requester_name ?? "-"}`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write these changes for real.");
    return;
  }

  console.log("\nApplying...");

  // Only two possible target values ('SV' / 'ONEST'), so this is two batched
  // UPDATEs total, not one per row.
  const svIds = planned.filter((p) => p.target === "SV").map((p) => p.request_id);
  const onestIds = planned.filter((p) => p.target === "ONEST").map((p) => p.request_id);
  const otherTargets = planned.filter((p) => p.target !== "SV" && p.target !== "ONEST");

  if (otherTargets.length > 0) {
    console.error(
      `Refusing to apply: ${otherTargets.length} row(s) resolved to a target company other than SV/ONEST (unexpected bu value). Fix the source data or this script's logic first.`,
    );
    process.exit(1);
  }

  // Supabase JS has no batch-size limit documented for .in(), but chunk
  // defensively anyway so one giant IN-list doesn't risk a URL/payload limit.
  async function applyChunked(ids: string[], target: "SV" | "ONEST") {
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error: updateError } = await admin.from("requests").update({ use_for_company: target }).in("request_id", chunk);
      if (updateError) {
        console.error(`Update failed for chunk starting at ${i} (target=${target}):`, updateError.message);
        process.exit(1);
      }
      console.log(`  Updated ${chunk.length} rows -> use_for_company=${target} (${i + chunk.length}/${ids.length})`);
    }
  }

  await applyChunked(svIds, "SV");
  await applyChunked(onestIds, "ONEST");

  console.log(`\nDone. ${svIds.length} rows -> SV, ${onestIds.length} rows -> ONEST.`);
}

main();
