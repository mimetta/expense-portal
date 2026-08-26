// Corrective follow-up to scripts/backfill-use-for-company.ts.
//
// The first backfill (Step 5, applied and confirmed already) set
// use_for_company to a single blanket company per person for these 8
// "crosses companies" people. That was wrong: these 8 people genuinely
// submit requests billed to EITHER company, and the GAS-imported `bu` column
// was actually recording which company each individual request was billed
// to — not the person's fixed home BU. This script corrects that, per
// request, for exactly these 8 people:
//
//   - If the request's current bu already equals the person's real/fixed BU
//     -> leave bu as is, set use_for_company to that same value.
//   - If the request's current bu does NOT match their real BU
//     -> that bu value was actually the billed-to company: move it into
//        use_for_company, and overwrite bu with the person's real BU.
//
// This is safe to run because scripts/backfill-use-for-company.ts never
// touched the `bu` column — only use_for_company — so the original
// GAS-imported bu values for these rows are still intact right now.
//
// Scope: only rows created by the 2026-07-21 bulk import (created_at date),
// AND belonging to one of these 8 people. This precisely targets the exact
// 433 rows the first backfill's "override" branch touched, without risking
// any row that already had a legitimately-chosen use_for_company from a live
// submission (those have a different created_at and are never selected
// here).
//
// Dry-run by default; pass --apply to write. Same convention as every other
// script in this repo.
//
// Run:
//   npx tsx scripts/fix-use-for-company-override.ts              (dry run)
//   npx tsx scripts/fix-use-for-company-override.ts --apply       (writes)

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

// The bulk import that created all 818 originally-missing rows landed on
// this single day (confirmed via scripts/report-missing-use-for-company.ts'
// created_at breakdown) — used here to scope this fix to exactly those rows.
const IMPORT_DAY = "2026-07-21";

// Real/fixed home BU per person, as confirmed directly by Darling (not the
// earlier, wrong "blanket target company" list).
const PEOPLE: { emails: string[]; realBu: "SV" | "ONEST"; label: string }[] = [
  { emails: ["thannaporn.s@mimetta.co"], realBu: "SV", label: "Klao Thannaporn" },
  { emails: ["noppatsorn.o@mimetta.co", "noppatsorn.k@mimetta.co"], realBu: "SV", label: "Noon Noppatsorn" },
  { emails: ["wacharanan.j@plantae.co"], realBu: "ONEST", label: "Wacharanan Jamkrajang / First Wacharanan" },
  { emails: ["sitanun.n@mimetta.co"], realBu: "ONEST", label: "Sitanun / Mew Sitanun" },
  { emails: ["pinprai.t@mimetta.co"], realBu: "SV", label: "Pin Pinprai" },
  { emails: ["roengchai.s@mimetta.co"], realBu: "SV", label: "Big Roengchai" },
  { emails: ["siriwan.b@mimetta.co"], realBu: "ONEST", label: "Siriwan Bunprasan / Kwang Siriwan" },
  { emails: ["tunyamon.p@mimetta.co"], realBu: "SV", label: "Nueng Tunyamon" },
];

const REAL_BU_BY_EMAIL = new Map<string, "SV" | "ONEST">();
for (const p of PEOPLE) for (const e of p.emails) REAL_BU_BY_EMAIL.set(e, p.realBu);

const ALL_EMAILS = PEOPLE.flatMap((p) => p.emails);

interface Row {
  request_id: string;
  bu: string;
  use_for_company: string | null;
  requester_email: string | null;
  requester_name: string | null;
  created_at: string | null;
}

async function main() {
  console.log(APPLY ? "APPLY MODE — this will write to the database.\n" : "DRY RUN — no writes will be made. Pass --apply to write for real.\n");
  console.log(`Fetching rows created on ${IMPORT_DAY} for the 8 cross-company people...\n`);

  const { data, error } = await admin
    .from("requests")
    .select("request_id, bu, use_for_company, requester_email, requester_name, created_at")
    .in("requester_email", ALL_EMAILS)
    .gte("created_at", `${IMPORT_DAY}T00:00:00Z`)
    .lt("created_at", `${IMPORT_DAY}T23:59:59.999Z`);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  if (rows.length === 0) {
    console.log("No matching rows found — nothing to fix.");
    return;
  }

  const plan = rows.map((r) => {
    const realBu = REAL_BU_BY_EMAIL.get(r.requester_email ?? "")!;
    const matches = r.bu === realBu;
    const newBu = realBu;
    const newUseForCompany = matches ? realBu : r.bu; // if mismatched, the OLD bu was the actual billed-to company
    return {
      request_id: r.request_id,
      requester_email: r.requester_email,
      requester_name: r.requester_name,
      oldBu: r.bu,
      oldUseForCompany: r.use_for_company,
      newBu,
      newUseForCompany,
      buChanged: r.bu !== newBu,
      ufcChanged: r.use_for_company !== newUseForCompany,
    };
  });

  console.log(`Total rows in scope: ${plan.length}\n`);

  console.log("--- Breakdown by person ---");
  for (const p of PEOPLE) {
    const rowsForPerson = plan.filter((x) => x.requester_email && p.emails.includes(x.requester_email));
    const buOverwrites = rowsForPerson.filter((x) => x.buChanged).length;
    const ufcCorrections = rowsForPerson.filter((x) => x.ufcChanged).length;
    console.log(
      `  ${p.label} (real BU = ${p.realBu}): ${rowsForPerson.length} rows — bu overwritten on ${buOverwrites}, use_for_company corrected on ${ufcCorrections}`,
    );
  }

  console.log("\n--- Sample of planned changes (first 25) ---");
  for (const p of plan.slice(0, 25)) {
    console.log(
      `  ${p.request_id}  bu: ${p.oldBu} -> ${p.newBu}${p.buChanged ? "  [CHANGED]" : ""}   use_for_company: ${p.oldUseForCompany} -> ${p.newUseForCompany}${p.ufcChanged ? "  [CHANGED]" : ""}   ${p.requester_name ?? "-"}`,
    );
  }

  if (!APPLY) {
    console.log(`\n(${plan.length} total rows planned — showing first 25 above.)`);
    console.log("\nDry run complete. Re-run with --apply to write these changes for real.");
    return;
  }

  console.log("\nApplying (one update per row, since bu and use_for_company both vary together)...");

  let done = 0;
  for (const p of plan) {
    const { error: updateError } = await admin
      .from("requests")
      .update({ bu: p.newBu, use_for_company: p.newUseForCompany })
      .eq("request_id", p.request_id);
    if (updateError) {
      console.error(`Update failed for ${p.request_id}:`, updateError.message);
      process.exit(1);
    }
    done++;
    if (done % 50 === 0 || done === plan.length) {
      console.log(`  Updated ${done}/${plan.length}`);
    }
  }

  console.log(`\nDone. ${plan.length} rows corrected.`);
}

main();
