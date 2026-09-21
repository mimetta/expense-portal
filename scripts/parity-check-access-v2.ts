// Stage 2a pass condition: the new tables + lib/access-v2.ts must reproduce
// docs/access-baseline.md cell for cell. Read-only.
import { readFileSync } from "node:fs"; import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const l of text.split("\n")) { const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; }
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function parseTable(md: string, start: string, end: string) {
  const s = md.indexOf(start), e = md.indexOf(end, s);
  // NOTE slice(1), not slice(2): the |---|---| separator does not start with
  // "| " so it is never captured by the filter above. slice(2) silently
  // dropped the first data row of every table — admin@mimetta.co — and a
  // parity check that skips a person proves nothing.
  const lines = md.slice(s, e).split("\n").filter(l => l.startsWith("| "));
  const header = lines[0].split("|").map(c => c.trim()).filter(Boolean);
  const rows = new Map<string, Record<string, string>>();
  for (const line of lines.slice(1)) {
    const cells = line.split("|").map(c => c.trim()); cells.shift(); cells.pop();
    if (!cells[0]?.startsWith("`")) continue;
    const email = cells[0].replace(/`/g, "");
    rows.set(email, Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
  }
  return { header, rows };
}

async function main() {
  const V2 = await import("../lib/access-v2");
  const md = readFileSync("docs/access-baseline.md", "utf8");

  const { data: people } = await a.from("people").select("*");
  const { data: prs } = await a.from("person_roles").select("*");
  const { data: scopes } = await a.from("bo_scopes").select("*");
  const { data: ovr } = await a.from("person_menu_overrides").select("*");
  const reqs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await a.from("requests").select("request_id,bu,department,cat_l1,petty_cash_holder_email,requester_email").range(f, f + 999);
    reqs.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const mk = (email: string) => {
    const p = people!.find(x => x.email === email)!;
    return {
      email, bu: p.bu, bu_defaulted: p.bu_defaulted, visible_departments: p.visible_departments,
      roles: prs!.filter(r => r.email === email).map(r => r.role),
      boScopes: scopes!.filter(s => s.email === email),
      overrides: Object.fromEntries(ovr!.filter(o => o.email === email).map(o => [o.menu, o.allowed])),
    } as never;
  };

  const pages = parseTable(md, "## Pages each person", "## Settings tabs");
  const tabs  = parseTable(md, "## Settings tabs", "## Actions");
  const acts  = parseTable(md, "## Actions", "## Spend report scope");
  const scope = parseTable(md, "## Spend report scope", "## Raw scope columns");
  const bus   = parseTable(md, "## Submit-form Business Unit", "## settings_tab_permissions");

  const diffs: string[] = [];
  const cmp = (who: string, what: string, expected: string, got: string) => {
    if (expected !== got) diffs.push(`${who} | ${what} | baseline=${expected} | v2=${got}`);
  };
  const YN = (b: boolean) => (b ? "Y" : "·");

  for (const [email, row] of Array.from(pages.rows.entries())) {
    const p = mk(email);
    for (const col of pages.header.slice(2)) cmp(email, `page:${col}`, row[col], YN(V2.canAccessPageV2(p, col)));
  }
  for (const [email, row] of Array.from(tabs.rows.entries())) {
    const p = mk(email);
    for (const col of tabs.header.slice(1)) cmp(email, `tab:${col}`, row[col], YN(V2.canAccessSettingsTabV2(p, col)));
  }
  for (const [email, row] of Array.from(acts.rows.entries())) {
    const p = mk(email);
    const boR = reqs.filter(r => V2.canBoActOnRequestV2(p, r)).length;
    const pcR = reqs.filter(r => V2.canPettyCashActOnRequestV2(p, r)).length;
    const vR  = reqs.filter(r => V2.canViewRequestV2(p, r)).length;
    const boOn = V2.isSuperadminV2(p) || V2.hasRoleV2(p, "BO");
    const pcOn = V2.isSuperadminV2(p) || V2.hasRoleV2(p, "PETTY_CASH_CUSTODIAN");
    cmp(email, "act:BO approve (reach)", row["BO approve (reach)"], boOn ? `Y (${boR})` : "·");
    cmp(email, "act:Petty cash sign-off (reach)", row["Petty cash sign-off (reach)"], pcOn ? `Y (${pcR})` : "·");
    cmp(email, "act:CEO approve", row["CEO approve"], YN(V2.isSuperadminV2(p) || V2.hasRoleV2(p, "CEO")));
    cmp(email, "act:Mark paid", row["Mark paid"], YN(V2.isSuperadminV2(p) || V2.hasRoleV2(p, "ACCOUNTING")));
    cmp(email, "act:Procurement edit", row["Procurement edit"], YN(V2.isSuperadminV2(p) || V2.hasRoleV2(p, "PROCUREMENT")));
    cmp(email, "act:Manage products", row["Manage products"], YN(V2.canManageProductsV2(p)));
    cmp(email, "act:Set revenue goals", row["Set revenue goals"], YN(V2.canEditRevenueGoalsV2(p)));
    cmp(email, "act:Can view (reach)", row["Can view (reach)"], String(vR));
  }
  for (const [email, row] of Array.from(scope.rows.entries())) {
    const p = mk(email); const s = V2.spendScopeV2(p);
    const got = s === "all" ? "everything (role)" : s === "bo" ? "their BO scope (unchanged)"
      : s === "none" ? "**nothing — no department assigned**" : `only ${(s as {departments:string[]}).departments.join(", ")}`;
    cmp(email, "spend-scope", row["what the spend report shows"], got);
  }
  for (const [email, row] of Array.from(bus.rows.entries())) {
    const p = mk(email);
    cmp(email, "submit BU", row["BU stamped"].replace(/\*\*/g, "").replace(" (default)", ""), V2.submitBuV2(p));
  }

  const cells = pages.rows.size * (pages.header.length - 2) + tabs.rows.size * (tabs.header.length - 1)
    + acts.rows.size * 8 + scope.rows.size + bus.rows.size;
  console.log(`compared ${cells} cells across ${pages.rows.size} people`);
  if (diffs.length === 0) { console.log("\nPARITY: ZERO DIFFERENCES ✓"); return; }
  console.log(`\nPARITY FAILED — ${diffs.length} differing cells:`);
  diffs.forEach(d => console.log("  " + d));
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
