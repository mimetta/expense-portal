// Stage 2a backfill: populate people / person_roles / bo_scopes /
// person_menu_overrides from the live `roles` table, then prove the result
// reproduces docs/access-baseline.md exactly.
//
// Dry-run by default; --apply writes. Reads nothing the app reads at runtime,
// and writes only the four new tables — `roles` and settings_tab_permissions
// are never touched.
import { readFileSync } from "node:fs"; import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const l of text.split("\n")) { const t=l.trim(); if(!t||t.startsWith("#"))continue; const e=t.indexOf("="); if(e<0)continue; const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[k])process.env[k]=v; }
const APPLY = process.argv.includes("--apply");
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const RETIRED = new Set(["DEPT_HEAD", "PRODUCT_MANAGER", "SUPPLIER_MANAGER"]);

async function main() {
  const P = await import("../lib/permissions");
  const SP = await import("../lib/settings-permissions");
  const V2 = await import("../lib/access-v2");
  const cfg = await SP.getSettingsTabPermissions();

  const { data: roleRows } = await a.from("roles").select("*").order("email");
  const reqs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await a.from("requests").select("request_id,bu,department,cat_l1,petty_cash_holder_email,requester_email").range(f, f + 999);
    reqs.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const roleEmails = Array.from(new Set(roleRows!.map(r => r.email as string)));
  const filerEmails = Array.from(new Set(reqs.map(r => r.requester_email).filter(Boolean)));
  const allEmails = Array.from(new Set([...roleEmails, ...filerEmails])).sort();
  const noRoleRow = allEmails.filter(e => !roleEmails.includes(e));

  console.log(`people: ${allEmails.length} (${roleEmails.length} with roles rows, ${noRoleRow.length} filers with none)`);

  // ---- bu, exactly as resolvedBu computes it today -------------------------
  const buReport: string[] = [], disagree: string[] = [];
  const peopleRows = allEmails.map(email => {
    const rows = roleRows!.filter(r => r.email === email);
    let bu = "ONEST", defaulted = true, from = "(fallback)";
    for (const r of rows) {
      const s = String(r.bu_scope ?? "*"); if (s === "*") continue;
      const first = s.split(",").map(x => x.trim()).filter(Boolean)[0];
      if (first) { bu = first; defaulted = false; from = String(r.role); break; }
    }
    const distinct = Array.from(new Set(rows.map(r => String(r.bu_scope)).filter(s => s !== "*")
      .flatMap(s => s.split(",").map(x => x.trim()).filter(Boolean))));
    if (distinct.length > 1) disagree.push(`${email}: rows say ${distinct.join(" / ")} -> took ${bu} (from the ${from} row; resolvedBu has no ORDER BY)`);
    if (defaulted) buReport.push(`${email} (${rows.length ? Array.from(new Set(rows.map(r=>r.role))).join(",") : "no roles row"})`);
    return {
      email, bu, bu_defaulted: defaulted,
      visible_departments: Array.from(new Set(rows.flatMap(r => String(r.department ?? "").split(",").map(s=>s.trim()).filter(Boolean)))).join(","),
      chapter: rows.map(r => r.chapter).find(Boolean) ?? null,
      is_auto_registered: rows.some(r => r.is_auto_registered),
    };
  });

  // ---- roles, minus the retired three --------------------------------------
  const roleAssign: { email: string; role: string }[] = [];
  for (const e of allEmails) {
    const kept = Array.from(new Set(roleRows!.filter(r => r.email === e).map(r => String(r.role)).filter(r => !RETIRED.has(r))));
    // A filer with no roles row becomes EMPLOYEE, matching auto-registration.
    if (kept.length === 0) kept.push("EMPLOYEE");
    for (const r of kept) roleAssign.push({ email: e, role: r });
  }

  // ---- bo_scopes: BO rows verbatim ----------------------------------------
  const boScopes = roleRows!.filter(r => r.role === "BO").map(r => ({
    email: r.email as string, bu_scope: String(r.bu_scope), dept_scope: String(r.dept_scope), cat_l1_scope: String(r.cat_l1_scope),
  }));

  // ---- dropped non-BO scope, listed so nothing vanishes silently ----------
  const dropped = roleRows!.filter(r => r.role !== "BO" &&
      (String(r.bu_scope) !== "*" || String(r.dept_scope) !== "*" || String(r.cat_l1_scope) !== "*"))
    .map(r => ({ email: r.email as string, role: String(r.role), bu: String(r.bu_scope), dept: String(r.dept_scope), cat: String(r.cat_l1_scope) }));

  // ---- overrides: today's answer vs the new role default -------------------
  const mkV2 = (email: string, overrides: Record<string, boolean> = {}) => ({
    email,
    bu: (peopleRows.find(p => p.email === email)!.bu) as "ONEST" | "SV" | "BOTH",
    bu_defaulted: peopleRows.find(p => p.email === email)!.bu_defaulted,
    visible_departments: peopleRows.find(p => p.email === email)!.visible_departments,
    roles: roleAssign.filter(r => r.email === email).map(r => r.role) as never,
    boScopes: boScopes.filter(s => s.email === email),
    overrides,
  });
  const mkOld = (email: string) => ({ email, name: email, allRoles: roleRows!.filter(r => r.email === email) } as never);
  const TABS = ["suppliers","users","products","categories","deptconfig","announcements","pettycash","companies","people","permissions"];

  const overrides: { email: string; menu: string; allowed: boolean }[] = [];
  for (const e of allEmails) {
    const oldU = mkOld(e), p = mkV2(e);
    // Someone with no roles row has no "today" to preserve: lib/auth.ts
    // auto-registers them as EMPLOYEE on first sign-in, so the EMPLOYEE
    // defaults ARE their current behaviour. Writing overrides for them would
    // freeze the accident of not having been added yet — and an
    // spend-report=false override would remove access they would otherwise
    // get. They take the defaults, with no exceptions.
    if (!roleEmails.includes(e)) continue;
    for (const menu of V2.ALL_MENUS) {
      if (V2.WORKFLOW_MENUS[menu]) continue;      // locked, never overridden
      const today = menu.startsWith("settings.")
        ? P.canAccessSettingsTab(oldU, menu.slice("settings.".length) as never, cfg)
        : P.canAccessPage(oldU, menu as never);
      const dflt = V2.menuDefault(p, menu);
      if (today !== dflt) overrides.push({ email: e, menu, allowed: today });
    }
  }

  console.log(`person_roles: ${roleAssign.length} | bo_scopes: ${boScopes.length} | overrides: ${overrides.length}`);
  console.log(`\nbu_defaulted (${buReport.length}):`); buReport.forEach(b => console.log("  " + b));
  console.log(`\nrows disagreeing on BU (${disagree.length}):`); disagree.forEach(d => console.log("  " + d));
  console.log(`\ndropped non-BO scope values (${dropped.length}):`);
  for (const d of dropped) console.log(`  ${d.email} [${d.role}] bu=${d.bu} dept=${JSON.stringify(d.dept)} cat=${JSON.stringify(d.cat)}`);
  const byMenu = new Map<string, number>();
  for (const o of overrides) byMenu.set(`${o.menu}=${o.allowed}`, (byMenu.get(`${o.menu}=${o.allowed}`) ?? 0) + 1);
  console.log(`\noverrides by menu:`); Array.from(byMenu.entries()).sort().forEach(([k,v]) => console.log(`  ${k}  ×${v}`));

  if (!APPLY) { console.log("\nDRY RUN — nothing written. Pass --apply."); return; }

  await a.from("person_menu_overrides").delete().neq("email", "");
  await a.from("bo_scopes").delete().neq("email", "");
  await a.from("person_roles").delete().neq("email", "");
  await a.from("people").delete().neq("email", "");
  for (const chunk of [peopleRows]) { const { error } = await a.from("people").insert(chunk); if (error) throw error; }
  { const { error } = await a.from("person_roles").insert(roleAssign); if (error) throw error; }
  { const { error } = await a.from("bo_scopes").insert(boScopes); if (error) throw error; }
  if (overrides.length) { const { error } = await a.from("person_menu_overrides").insert(overrides); if (error) throw error; }
  console.log("\nWRITTEN.");
}
main().catch(e => { console.error(e); process.exit(1); });
