// The decisive stage 2b check: run the OLD logic (CurrentUser built from the
// legacy `roles` table, no `person` — permissions.ts falls through to its
// pre-2b implementation) and the NEW logic (CurrentUser built the way
// getCurrentUser now builds it) against the SAME, CURRENT request set, and
// diff them directly.
//
// This is stronger than diffing against docs/access-baseline.md, whose reach
// counts are a snapshot: three requests have been submitted since.
import { readFileSync } from "node:fs"; import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const l of text.split("\n")) { const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; }
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const P = await import("../lib/permissions");
  const SP = await import("../lib/settings-permissions");
  const S = await import("../lib/spend");
  const { loadPerson, projectAllRoles } = await import("../lib/person");
  const cfg = await SP.getSettingsTabPermissions();   // legacy config, for the old path

  const { data: roleRows } = await a.from("roles").select("*");
  const reqs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await a.from("requests").select("request_id,bu,department,cat_l1,petty_cash_holder_email,requester_email").range(f, f + 999);
    reqs.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  console.log(`${reqs.length} requests in play (baseline snapshot had 1162)`);

  const emails = Array.from(new Set(roleRows!.map(r => r.email as string))).sort();
  const PAGES = P.PAGES;
  // Stage 2c merged users/people/permissions into one `usersaccess` menu.
  // The three always moved together and were all SUPERADMIN-only, so the old
  // `users` answer is the right thing to compare the merged one against.
  const TABS = ["suppliers","products","categories","deptconfig","announcements","pettycash","companies"];

  const diffs: string[] = [], intended: string[] = [], changedSince: string[] = [];
  for (const email of emails) {
    // OLD: no `person`, so every delegating function takes its legacy branch.
    const oldU = { email, name: email, allRoles: roleRows!.filter(r => r.email === email) } as never;
    const person = await loadPerson(email);
    if (!person) { diffs.push(`${email} | MISSING from people`); continue; }
    // The legacy `roles` table is FROZEN as of stage 2b: the app writes only
    // the new tables now. So anyone whose access has genuinely been changed
    // since the switch will differ here BY DESIGN, and comparing them would
    // report a real admin action as a regression. Skip and report them.
    const legacyRoles = Array.from(new Set((roleRows!.filter(r => r.email === email)).map(r => String(r.role)))).sort();
    const liveRoles = [...person.roles].sort();
    if (JSON.stringify(legacyRoles) !== JSON.stringify(liveRoles)) {
      changedSince.push(`${email} | legacy=${legacyRoles.join(",") || "(none)"} | now=${liveRoles.join(",") || "(none)"}`);
      continue;
    }
    const newU = { email, name: email, allRoles: projectAllRoles(person), chapter: person.chapter, person } as never;

    const cmp = (what: string, o: unknown, n: unknown) => {
      if (String(o) === String(n)) return;
      (what === "page:settings" ? intended : diffs).push(`${email} | ${what} | old=${o} | new=${n}`);
    };
    for (const p of PAGES) cmp(`page:${p}`, P.canAccessPage(oldU, p), P.canAccessPage(newU, p));
    for (const t of TABS) cmp(`tab:${t}`, P.canAccessSettingsTab(oldU, t as never, cfg), P.canAccessSettingsTab(newU, t as never));
    cmp("tab:usersaccess (was users/people/permissions)",
        P.canAccessSettingsTab(oldU, "users" as never, cfg),
        P.canAccessSettingsTab(newU, "usersaccess" as never));
    cmp("canManageProducts", P.canManageProducts(oldU, cfg), P.canManageProducts(newU));
    cmp("bo-reach", reqs.filter(r => P.canBoActOnRequest(oldU, r)).length, reqs.filter(r => P.canBoActOnRequest(newU, r)).length);
    cmp("pettycash-reach", reqs.filter(r => P.canPettyCashActOnRequest(oldU, r)).length, reqs.filter(r => P.canPettyCashActOnRequest(newU, r)).length);
    cmp("view-reach", reqs.filter(r => P.canViewRequest(oldU, r)).length, reqs.filter(r => P.canViewRequest(newU, r)).length);
    cmp("spend-departments", S.viewerDepartments(oldU).sort().join(","), S.viewerDepartments(newU).sort().join(","));
  }

  console.log(`\ncompared ${emails.length - changedSince.length} of ${emails.length} people on identical inputs`);
  if (changedSince.length) {
    console.log(`\nSKIPPED — access genuinely changed since the switch, so the frozen legacy row is stale (expected):`);
    changedSince.forEach(d => console.log("  " + d));
  }
  console.log(`INTENDED (Settings page): ${intended.length}`);
  intended.forEach(d => console.log("  " + d));
  if (diffs.length === 0) { console.log("\nUNINTENDED: NONE ✓"); return; }
  console.log(`\nUNINTENDED — ${diffs.length}:`); diffs.forEach(d => console.log("  " + d)); process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
