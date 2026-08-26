// Read-only report — writes nothing, ever. Run any time, no --apply flag.
//
// Finds every request whose `use_for_company` is null (almost entirely the
// pre-migration rows imported from the old GAS system, which predates that
// field — see CLAUDE.md "Use for company"/"Legacy requests import script")
// and breaks them down by BU, Segment (department), and requester, plus a
// sample of request IDs, so a human can spot-check for cases where the
// submitter's own BU does NOT match which company the expense was actually
// billed to before we backfill use_for_company from bu.
//
// Run:
//   npx tsx scripts/report-missing-use-for-company.ts
//   npm run report:missing-company        (same thing, see package.json)
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
  bu: string;
  department: string | null;
  requester_name: string | null;
  requester_email: string | null;
  timestamp: string;
  created_at: string | null;
  budget_period: string | null;
  total: number | null;
}

function tally(rows: Row[], key: (r: Row) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "(blank)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

async function main() {
  console.log("Fetching requests where use_for_company is null...\n");

  const { data, error } = await admin
    .from("requests")
    .select("request_id, bu, department, requester_name, requester_email, timestamp, created_at, budget_period, total")
    .is("use_for_company", null)
    .order("timestamp", { ascending: true });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  if (rows.length === 0) {
    console.log("Nothing to report — every request already has use_for_company set.");
    return;
  }

  console.log(`Total requests missing use_for_company: ${rows.length}\n`);

  console.log("--- By BU ---");
  for (const [bu, count] of tally(rows, (r) => r.bu)) {
    console.log(`  ${bu}: ${count}`);
  }

  console.log("\n--- By Segment (department) ---");
  for (const [dept, count] of tally(rows, (r) => r.department ?? "")) {
    console.log(`  ${dept}: ${count}`);
  }

  console.log("\n--- By requester (top 20) ---");
  for (const [requester, count] of tally(rows, (r) => `${r.requester_name} <${r.requester_email}>`).slice(0, 20)) {
    console.log(`  ${requester}: ${count}`);
  }

  const dates = rows.map((r) => r.timestamp).sort();
  console.log(`\n--- Date range (timestamp = original/legacy submission date) ---`);
  console.log(`  Earliest: ${dates[0]}`);
  console.log(`  Latest:   ${dates[dates.length - 1]}`);

  // The key question: were these rows trickling in live (created_at spread
  // out day by day, matching timestamp) or dumped in via a bulk import
  // script (created_at clustered on a handful of days regardless of what
  // timestamp says)? If created_at clusters tightly, these 818 are almost
  // certainly import-script writes, not gaps from real live users skipping
  // the (client-side-required) "Use for company" field on /submit.
  const createdDayCounts = tally(rows, (r) => (r.created_at ? r.created_at.slice(0, 10) : "(no created_at)"));
  console.log(`\n--- By created_at day (row-insert date — reveals bulk-import batches vs live trickle) ---`);
  for (const [day, count] of createdDayCounts) {
    console.log(`  ${day}: ${count}`);
  }
  console.log(`  (${createdDayCounts.length} distinct insert day(s) across ${rows.length} rows)`);

  console.log(`\n--- Sample of request IDs (first 30) ---`);
  for (const r of rows.slice(0, 30)) {
    console.log(
      `  ${r.request_id}  bu=${r.bu}  dept=${r.department ?? "-"}  ${r.requester_name ?? "-"}  ${formatMoney(r.total)}  ${r.timestamp}`,
    );
  }

  console.log(
    `\nFull list (all ${rows.length} request IDs) below — scan for anything that looks like it might have been billed to a different company than its BU/department suggests:\n`,
  );
  for (const r of rows) {
    console.log(`  ${r.request_id}  bu=${r.bu}  dept=${r.department ?? "-"}  ${r.requester_name ?? "-"}`);
  }
}

function formatMoney(n: number | null): string {
  if (n === null) return "-";
  return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

main();
