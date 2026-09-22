// Stage 2b verification: rebuild the access matrix by calling the APP'S OWN
// permission functions — lib/permissions.ts, lib/settings-permissions.ts,
// lib/spend.ts — now that they are rewired to the new tables, and diff
// against docs/access-baseline.md.
//
// Deliberately NOT lib/access-v2.ts: that would re-prove the pure functions
// rather than the wiring. The CurrentUser objects here are built the way
// lib/auth.ts#getCurrentUser builds them, via loadPerson + projectAllRoles.
import { readFileSync } from "node:fs"; import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const l of text.split("\n")) { const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; }
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function parseTable(md: string, start: string, end: string) {
  const s = md.indexOf(start), e = md.indexOf(end, s);
  const lines = md.slice(s, e).split("\n").filter(l => l.startsWith("| "));
  const header = lines[0].split("|").map(c => c.trim()).filter(Boolean);
  const rows = new Map<string, Record<string, string>>();
  for (const line of lines.slice(1)) {
    const cells = line.split("|").map(c => c.trim()); cells.shift(); cells.pop();
    if (!cells[0]?.startsWith("`")) continue;
    rows.set(cells[0].replace(/`/g, ""), Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
  }
  return { header, rows };
}

async function main() {
  const P = await import("../lib/permissions");          // the app's own
  const RG = await import("../lib/revenue-goals");
  const { loadPerson, projectAllRoles } = await import("../lib/person");
  const md = readFileSync("docs/access-baseline.md", "utf8");

  const reqs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await a.from("requests").select("request_id,bu,department,cat_l1,petty_cash_holder_email,requester_email").range(f, f + 999);
    reqs.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }

  const pages = parseTable(md, "## Pages each person", "## Settings tabs");
  const tabs  = parseTable(md, "## Settings tabs", "## Actions");
  const acts  = parseTable(md, "## Actions", "## Spend report scope");
  const scope = parseTable(md, "## Spend report scope", "## Raw scope columns");
  const bus   = parseTable(md, "## Submit-form Business Unit", "## settings_tab_permissions");

  // Exactly how getCurrentUser assembles a CurrentUser.
  const users = new Map<string, any>();
  for (const email of Array.from(pages.rows.keys())) {
    const person = await loadPerson(email);
    if (!person) { users.set(email, null); continue; }
    users.set(email, { email, name: email, allRoles: projectAllRoles(person), chapter: person.chapter, person });
  }

  const diffs: string[] = [], intended: string[] = [];
  const cmp = (who: string, what: string, exp: string, got: string) => {
    if (exp === got) return;
    (what === "page:settings" && exp === "Y" && got === "·" ? intended : diffs)
      .push(`${who} | ${what} | baseline=${exp} | now=${got}`);
  };
  const YN = (b: boolean) => (b ? "Y" : "·");

  for (const [email, row] of Array.from(pages.rows.entries())) {
    const u = users.get(email);
    for (const col of pages.header.slice(2)) cmp(email, `page:${col}`, row[col], YN(P.canAccessPage(u, col as never)));
  }
  for (const [email, row] of Array.from(tabs.rows.entries())) {
    const u = users.get(email);
    for (const col of tabs.header.slice(1)) cmp(email, `tab:${col}`, row[col], YN(P.canAccessSettingsTab(u, col as never)));
  }
  for (const [email, row] of Array.from(acts.rows.entries())) {
    const u = users.get(email);
    const boOn = P.isSuperadmin(u) || P.hasRole(u, "BO");
    const pcOn = P.isSuperadmin(u) || P.hasRole(u, "PETTY_CASH_CUSTODIAN");
    cmp(email, "act:BO approve (reach)", row["BO approve (reach)"], boOn ? `Y (${reqs.filter(r => P.canBoActOnRequest(u, r)).length})` : "·");
    cmp(email, "act:Petty cash sign-off (reach)", row["Petty cash sign-off (reach)"], pcOn ? `Y (${reqs.filter(r => P.canPettyCashActOnRequest(u, r)).length})` : "·");
    cmp(email, "act:CEO approve", row["CEO approve"], YN(P.isSuperadmin(u) || P.hasRole(u, "CEO")));
    cmp(email, "act:Mark paid", row["Mark paid"], YN(P.isSuperadmin(u) || P.hasRole(u, "ACCOUNTING")));
    cmp(email, "act:Procurement edit", row["Procurement edit"], YN(P.isSuperadmin(u) || P.hasRole(u, "PROCUREMENT")));
    cmp(email, "act:Manage products", row["Manage products"], YN(P.canManageProducts(u)));
    cmp(email, "act:Set revenue goals", row["Set revenue goals"], YN(RG.canEditRevenueGoals(u)));
    cmp(email, "act:Can view (reach)", row["Can view (reach)"], String(reqs.filter(r => P.canViewRequest(u, r)).length));
  }
  const S = await import("../lib/spend");
  for (const [email, row] of Array.from(scope.rows.entries())) {
    const u = users.get(email);
    const depts = S.viewerDepartments(u);
    const got = (P.isSuperadmin(u) || P.hasRole(u, "CEO") || P.hasRole(u, "ACCOUNTING")) ? "everything (role)"
      : P.hasRole(u, "BO") ? "their BO scope (unchanged)"
      : depts.length ? `only ${depts.join(", ")}` : "**nothing — no department assigned**";
    cmp(email, "spend-scope", row["what the spend report shows"], got);
  }
  for (const [email, row] of Array.from(bus.rows.entries())) {
    const u = users.get(email);
    const bu = u.person.bu === "BOTH" ? "ONEST" : u.person.bu;   // BOTH => picker, defaults ONEST
    cmp(email, "submit BU", row["BU stamped"].replace(/\*\*/g, "").replace(" (default)", ""), bu);
  }

  console.log(`compared ${pages.rows.size} people through the app's own functions`);
  console.log(`\nINTENDED (Settings page removed for people with no tabs): ${intended.length}`);
  intended.forEach(d => console.log("  " + d));
  if (diffs.length === 0) { console.log("\nUNINTENDED DIFFERENCES: NONE ✓"); return; }
  console.log(`\nUNINTENDED DIFFERENCES — ${diffs.length}:`);
  diffs.forEach(d => console.log("  " + d));
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
