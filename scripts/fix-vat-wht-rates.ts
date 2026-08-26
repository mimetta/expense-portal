// Fixes the VAT/WHT rate import bug found via scripts/report-vat-wht-rates.ts.
//
// Confirmed: 454 rows (all created 2026-07-21, the legacy bulk import) have
// vat_rate and/or wht_rate stored as a fraction (0.07) instead of this app's
// actual convention, a whole-number percent (7) — see
// components/shared/RequestDetailModal.tsx, which displays `${rate}%`
// directly and divides by 100 when computing money. The separately-imported
// vat_amount/wht_amount/total currency columns were checked against a
// sample and are already correct (independently sourced from the CSV, not
// derived from the buggy rate at import time) — so this script ONLY touches
// vat_rate/wht_rate, both the top-level requests columns and items_json
// (legacy rows are always single-item, so both hold the same value and both
// need the same fix).
//
// Only rows where a rate is strictly between 0 and 1 are touched — a real
// VAT/WHT percent is always a small whole number (7, 3, 1, 5, 0, ...),
// never a fraction like 0.07, so this is a safe, precise signal. A rate of
// exactly 0 is left alone (genuinely means "no VAT/WHT", not a scaling bug).
//
// Also separately reports (but does NOT auto-fix) rows where a rate is 0
// but the corresponding amount column is nonzero — a pre-existing data
// inconsistency independent of this bug (found one example:
// EXP-2026-05-000135) that can't be reliably auto-corrected since the
// correct rate isn't recoverable from what's stored.
//
// Dry-run by default; pass --apply to write. Same convention as every other
// script in this repo.
//
// Run:
//   npx tsx scripts/fix-vat-wht-rates.ts              (dry run)
//   npx tsx scripts/fix-vat-wht-rates.ts --apply       (writes)

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

interface Item {
  vat_rate: number;
  wht_rate: number;
  [key: string]: unknown;
}

interface Row {
  request_id: string;
  vat_rate: number | null;
  wht_rate: number | null;
  vat_amount: number | null;
  wht_amount: number | null;
  items_json: Item[] | null;
}

function isSuspiciousFraction(rate: number | null | undefined): rate is number {
  return rate !== null && rate !== undefined && rate > 0 && rate < 1;
}

function fixRate(rate: number): number {
  // Round to 2 decimals to clean up float noise (0.07*100 = 7.000000000000001).
  return Math.round(rate * 100 * 100) / 100;
}

async function main() {
  console.log(APPLY ? "APPLY MODE — this will write to the database.\n" : "DRY RUN — no writes will be made. Pass --apply to write for real.\n");
  console.log("Fetching all requests...\n");

  const { data, error } = await admin
    .from("requests")
    .select("request_id, vat_rate, wht_rate, vat_amount, wht_amount, items_json");

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  const plan: {
    request_id: string;
    oldVatRate: number | null;
    newVatRate: number | null;
    oldWhtRate: number | null;
    newWhtRate: number | null;
    newItemsJson: Item[] | null;
    changed: boolean;
  }[] = [];

  const anomalies: { request_id: string; note: string }[] = [];

  for (const r of rows) {
    let changed = false;
    const newVatRate = isSuspiciousFraction(r.vat_rate) ? fixRate(r.vat_rate) : r.vat_rate;
    const newWhtRate = isSuspiciousFraction(r.wht_rate) ? fixRate(r.wht_rate) : r.wht_rate;
    if (newVatRate !== r.vat_rate) changed = true;
    if (newWhtRate !== r.wht_rate) changed = true;

    let newItemsJson = r.items_json;
    if (r.items_json && r.items_json.length > 0) {
      let itemsChanged = false;
      newItemsJson = r.items_json.map((it) => {
        const fixedVat = isSuspiciousFraction(it.vat_rate) ? fixRate(it.vat_rate) : it.vat_rate;
        const fixedWht = isSuspiciousFraction(it.wht_rate) ? fixRate(it.wht_rate) : it.wht_rate;
        if (fixedVat !== it.vat_rate || fixedWht !== it.wht_rate) itemsChanged = true;
        return { ...it, vat_rate: fixedVat, wht_rate: fixedWht };
      });
      if (itemsChanged) changed = true;
      if (!itemsChanged) newItemsJson = r.items_json;
    }

    if (changed) {
      plan.push({
        request_id: r.request_id,
        oldVatRate: r.vat_rate,
        newVatRate,
        oldWhtRate: r.wht_rate,
        newWhtRate,
        newItemsJson,
        changed,
      });
    }

    // Anomaly check: rate is 0 (or null) but the matching amount is nonzero
    // — can't be auto-fixed (correct rate isn't recoverable), flagged for
    // manual review only.
    if ((r.vat_rate === 0 || r.vat_rate === null) && r.vat_amount && Math.abs(r.vat_amount) > 0.01) {
      anomalies.push({
        request_id: r.request_id,
        note: `vat_rate=${r.vat_rate} but vat_amount=${r.vat_amount} (nonzero) — rate not auto-fixable`,
      });
    }
    if ((r.wht_rate === 0 || r.wht_rate === null) && r.wht_amount && Math.abs(r.wht_amount) > 0.01) {
      anomalies.push({
        request_id: r.request_id,
        note: `wht_rate=${r.wht_rate} but wht_amount=${r.wht_amount} (nonzero) — rate not auto-fixable`,
      });
    }
  }

  console.log(`Total rows to fix: ${plan.length}\n`);
  console.log("--- Sample of planned changes (first 25) ---");
  for (const p of plan.slice(0, 25)) {
    console.log(
      `  ${p.request_id}  vat_rate: ${p.oldVatRate} -> ${p.newVatRate}   wht_rate: ${p.oldWhtRate} -> ${p.newWhtRate}`,
    );
  }
  console.log(`\n(${plan.length} total rows planned — showing first 25 above.)`);

  if (anomalies.length > 0) {
    console.log(`\n--- ⚠️  ${anomalies.length} pre-existing anomalies found (NOT auto-fixed, needs manual review) ---`);
    for (const a of anomalies) {
      console.log(`  ${a.request_id}: ${a.note}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write these changes for real.");
    return;
  }

  console.log("\nApplying (one update per row, since items_json content varies per row)...");

  let done = 0;
  for (const p of plan) {
    const { error: updateError } = await admin
      .from("requests")
      .update({ vat_rate: p.newVatRate, wht_rate: p.newWhtRate, items_json: p.newItemsJson })
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
