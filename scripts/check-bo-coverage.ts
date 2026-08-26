// Reports every (bu, department, cat_l1) line in `categories` that no BO's
// scope matches, and exits non-zero if any exist.
//
//   npx tsx scripts/check-bo-coverage.ts        # or: npm run check:bo-coverage
//   npx tsx scripts/check-bo-coverage.ts --json # machine-readable, for CI
//
// WHY THIS EXISTS: migration 021 replaced two BOs' cat_l1_scope = '*' with
// explicit comma-separated lists, to stop them colliding with wacharanan.j's
// company-wide HR Salary ownership. Enumerated scopes go stale silently — add
// a category in Settings and no scope mentions it, so the line simply has no
// budget owner and nothing anywhere says so. This turns that into a failing
// check.
//
// READ-ONLY. Writes nothing.
//
// The matcher is IMPORTED from lib/permissions.ts, deliberately not
// reimplemented here. A second copy of the comma-splitting/wildcard rules
// would drift from the real one and this check would then pass while the app
// disagreed with it — which is the exact failure mode it is meant to catch.
// boScopeMatchesRequest takes an ExpenseRequest; only bu/department/cat_l1 are
// read, so a three-field object is cast to it, the same way
// lib/spend.ts#scopeFilter already does.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { boScopeMatchesRequest } from "../lib/permissions";
import type { ExpenseRequest, RoleRow } from "../types/database";

function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // fine if it doesn't exist — real env vars may already be set
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}
loadEnvLocal();

const JSON_OUT = process.argv.includes("--json");
const APPROVED = ["CEO_APPROVED", "PAID"];

interface CategoryRow {
  bu: string;
  department: string;
  cat_l1: string | null;
  cat_l2: string | null;
}
interface SpendRow {
  bu: string;
  department: string | null;
  cat_l1: string | null;
  amount: number | string;
  fiscal_year: number;
  status: string;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  async function all<T>(table: string, select: string): Promise<T[]> {
    const out: T[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select(select).range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  const roles = await all<RoleRow>("roles", "id, email, role, bu_scope, dept_scope, cat_l1_scope");
  const cats = await all<CategoryRow>("categories", "bu, department, cat_l1, cat_l2");
  const spend = await all<SpendRow>("v_request_spend", "bu, department, cat_l1, amount, fiscal_year, status");

  const bos = roles.filter((r) => r.role === "BO");
  const fiscalYear = new Date().getFullYear();

  // FY spend per (bu, department, cat_l1), approved basis.
  const spendBy = new Map<string, number>();
  for (const s of spend) {
    if (s.fiscal_year !== fiscalYear || !APPROVED.includes(s.status)) continue;
    const k = `${s.bu}|${s.department}|${s.cat_l1}`;
    spendBy.set(k, (spendBy.get(k) ?? 0) + Number(s.amount));
  }

  const ownersOf = (bu: string, department: string | null, cat_l1: string | null) =>
    bos
      .filter((scope) =>
        boScopeMatchesRequest(scope, { bu, department, cat_l1 } as unknown as ExpenseRequest),
      )
      .map((b) => b.email);

  // One entry per distinct (bu, department, cat_l1) — cat_l2 does not
  // participate in BO scoping, so reporting per cat_l2 row would just repeat
  // the same finding several times.
  const combos = new Map<string, CategoryRow & { lines: number }>();
  for (const c of cats) {
    const k = `${c.bu}|${c.department}|${c.cat_l1}`;
    const e = combos.get(k);
    if (e) e.lines++;
    else combos.set(k, { ...c, lines: 1 });
  }

  const unowned = [...combos.entries()]
    .filter(([, c]) => ownersOf(c.bu, c.department, c.cat_l1).length === 0)
    .map(([k, c]) => ({
      bu: c.bu,
      department: c.department,
      cat_l1: c.cat_l1,
      category_lines: c.lines,
      fy_spend: Math.round((spendBy.get(k) ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.fy_spend - a.fy_spend || a.bu.localeCompare(b.bu));

  if (JSON_OUT) {
    console.log(JSON.stringify({ fiscalYear, combinations: combos.size, unowned }, null, 2));
    process.exit(unowned.length > 0 ? 1 : 0);
  }

  console.log(`BO coverage check — ${combos.size} (bu, department, cat_l1) combinations in categories`);
  console.log(`BO scope rows: ${bos.length} across ${new Set(bos.map((b) => b.email)).size} users`);
  console.log(`FY${fiscalYear} spend basis: ${APPROVED.join(" + ")}\n`);

  if (unowned.length === 0) {
    console.log("PASS — every category line has at least one BO whose scope matches it.");
    process.exit(0);
  }

  console.log(`FAIL — ${unowned.length} combination(s) matched by NO BO scope:\n`);
  const w = Math.max(...unowned.map((u) => String(u.cat_l1).length), 10);
  console.log(`  ${"BU".padEnd(6)} ${"DEPARTMENT".padEnd(24)} ${"CAT_L1".padEnd(w)} LINES  FY${fiscalYear} SPEND`);
  for (const u of unowned) {
    console.log(
      `  ${u.bu.padEnd(6)} ${u.department.padEnd(24)} ${String(u.cat_l1).padEnd(w)} ${String(u.category_lines).padStart(5)}  ${u.fy_spend ? "฿" + u.fy_spend.toLocaleString("en-US") : "-"}`,
    );
  }
  const total = unowned.reduce((s, u) => s + u.fy_spend, 0);
  console.log(`\n  ${unowned.length} combination(s), ${unowned.reduce((s, u) => s + u.category_lines, 0)} category line(s), ฿${Math.round(total).toLocaleString("en-US")} of FY${fiscalYear} spend with no budget owner.`);
  console.log("\nFix by widening a BO's bu_scope/dept_scope/cat_l1_scope, or by granting a new BO row.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
