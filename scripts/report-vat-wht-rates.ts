// Read-only report — writes nothing, ever. Run any time, no --apply flag.
//
// Investigating a bug Darling found: legacy-imported requests show VAT/WHT
// rates like "0.07%" instead of "7%". Confirmed root cause by reading the
// code:
//   - components/shared/RequestDetailModal.tsx displays `${item.vat_rate}%`
//     directly (no scaling) and computes money amounts as
//     (amount_net * vat_rate) / 100 — so the app's convention is that
//     vat_rate/wht_rate are stored as whole-number percents (7 for 7%), not
//     fractions (0.07 for 7%).
//   - scripts/import-expensedb-requests.ts stores `num(row.vat_rate)` as-is,
//     with no scaling — so if the legacy CSV's vat_rate column held a
//     fraction (0.07) rather than a whole-number percent (7), it got
//     imported wrong, 100x too small, into both the top-level
//     requests.vat_rate/wht_rate columns AND items_json[0].vat_rate/wht_rate
//     (legacy rows are always single-item, per that script's own code).
//
// This script quantifies the actual scope before anything gets fixed:
//   - How many rows have a suspiciously fractional rate (0 < rate < 1) —
//     a real Thai VAT/WHT percent is always a small whole number (7, 3, 1,
//     5, 0, etc.), never a fraction like 0.07, so this is a reliable signal.
//   - Which created_at day(s) those rows are on (confirms/denies whether
//     this is confined to the same 2026-07-21 bulk import already found for
//     the use_for_company issue, or spread across multiple import batches).
//   - Whether the separately-imported requests.vat_amount/wht_amount/total
//     currency columns already look correct (computed independently from
//     amount_net * real_rate/100) or are ALSO wrong — determines whether the
//     fix only needs to touch vat_rate/wht_rate, or those too.
//
// Run:
//   npx tsx scripts/report-vat-wht-rates.ts
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

interface Row {
  request_id: string;
  vat_rate: number | null;
  wht_rate: number | null;
  vat_amount: number | null;
  wht_amount: number | null;
  amount_net: number | null;
  total: number | null;
  created_at: string | null;
  items_json: { vat_rate: number; wht_rate: number; amount_net: number }[] | null;
}

function isSuspiciousFraction(rate: number | null): boolean {
  return rate !== null && rate > 0 && rate < 1;
}

async function main() {
  console.log("Fetching all requests to check vat_rate/wht_rate...\n");

  const { data, error } = await admin
    .from("requests")
    .select("request_id, vat_rate, wht_rate, vat_amount, wht_amount, amount_net, total, created_at, items_json");

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`Total requests in table: ${rows.length}\n`);

  const affected = rows.filter(
    (r) =>
      isSuspiciousFraction(r.vat_rate) ||
      isSuspiciousFraction(r.wht_rate) ||
      (r.items_json ?? []).some((it) => isSuspiciousFraction(it.vat_rate) || isSuspiciousFraction(it.wht_rate)),
  );

  console.log(`Rows with a suspiciously fractional rate (0 < rate < 1, top-level or per-item): ${affected.length}\n`);

  if (affected.length === 0) {
    console.log("Nothing looks affected. Stopping here.");
    return;
  }

  console.log("--- By created_at day ---");
  const dayCounts = new Map<string, number>();
  for (const r of affected) {
    const day = r.created_at ? r.created_at.slice(0, 10) : "(no created_at)";
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  for (const [day, count] of Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${day}: ${count}`);
  }

  console.log("\n--- Sanity check: is vat_amount/wht_amount/total independently correct, or also wrong? ---");
  console.log("(Comparing stored vat_amount against what amount_net * (rate*100) / 100 SHOULD be if rate were correctly scaled)\n");
  for (const r of affected.slice(0, 15)) {
    const net = r.amount_net ?? 0;
    const correctedVatRate = r.vat_rate !== null && r.vat_rate > 0 && r.vat_rate < 1 ? r.vat_rate * 100 : r.vat_rate;
    const correctedWhtRate = r.wht_rate !== null && r.wht_rate > 0 && r.wht_rate < 1 ? r.wht_rate * 100 : r.wht_rate;
    const expectedVatAmount = correctedVatRate ? Math.round(((net * correctedVatRate) / 100) * 100) / 100 : 0;
    const expectedWhtAmount = correctedWhtRate ? Math.round(((net * correctedWhtRate) / 100) * 100) / 100 : 0;
    console.log(
      `  ${r.request_id}  net=${net}  stored vat_rate=${r.vat_rate} wht_rate=${r.wht_rate}  stored vat_amount=${r.vat_amount} wht_amount=${r.wht_amount} total=${r.total}`,
    );
    console.log(
      `    if rate should be ${correctedVatRate}% / ${correctedWhtRate}% -> expected vat_amount=${expectedVatAmount} wht_amount=${expectedWhtAmount} expected total=${Math.round((net + expectedVatAmount - expectedWhtAmount) * 100) / 100}`,
    );
    console.log(
      `    stored vat_amount ${r.vat_amount === expectedVatAmount ? "MATCHES the corrected expectation (already right, rate is the only bug)" : "does NOT match — vat_amount/total may also need fixing"}`,
    );
  }

  console.log(`\n(${affected.length} total affected rows — showing first 15 above for the sanity check.)`);
}

main();
