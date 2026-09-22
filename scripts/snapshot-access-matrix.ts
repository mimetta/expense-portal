// Dumps the FULL access matrix as JSON by calling the app's own permission
// functions — the same ones verify-rewired-access.ts calls, assembled the
// same way lib/auth.ts#getCurrentUser assembles a CurrentUser.
//
// WHY THIS EXISTS ALONGSIDE verify-rewired-access.ts. That script diffs
// against docs/access-baseline.md, a committed snapshot. The baseline
// legitimately drifts as admins assign departments and as new requests
// arrive, so it cannot answer "did THIS change alter anyone's access" — its
// diff is never empty. This dumps the live matrix instead, so the same
// script run before and after a change diffs to zero when nothing moved.
//
//   npx tsx scripts/snapshot-access-matrix.ts > /tmp/before.json
//   ...make the change...
//   npx tsx scripts/snapshot-access-matrix.ts > /tmp/after.json
//   diff /tmp/before.json /tmp/after.json
//
// Request-reach counts are included and DO move when requests are submitted,
// so before/after must be taken close together — or compared on the
// permission columns alone.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const l of text.split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const e = t.indexOf("="); if (e < 0) continue;
  const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const P = await import("../lib/permissions");
  const RG = await import("../lib/revenue-goals");
  const S = await import("../lib/spend");
  const { loadPerson, projectAllRoles } = await import("../lib/person");

  const reqs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await a
      .from("requests")
      .select("request_id,bu,department,cat_l1,petty_cash_holder_email,requester_email")
      .range(f, f + 999);
    reqs.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }

  const { data: people } = await a.from("people").select("email").order("email");
  const TABS = ["suppliers", "products", "categories", "deptconfig", "announcements", "pettycash", "companies", "usersaccess"];
  const out: Record<string, unknown> = {};

  for (const { email } of people ?? []) {
    const person = await loadPerson(email);
    if (!person) continue;
    const u: any = { email, name: email, allRoles: projectAllRoles(person), chapter: person.chapter, person };
    const depts = S.viewerDepartments(u);
    out[email] = {
      roles: person.roles.slice().sort(),
      active: person.active,
      pages: Object.fromEntries(P.PAGES.map((p) => [p, P.canAccessPage(u, p)])),
      tabs: Object.fromEntries(TABS.map((t) => [t, P.canAccessSettingsTab(u, t as never)])),
      actions: {
        boApprove: reqs.filter((r) => P.canBoActOnRequest(u, r)).length,
        pettyCash: reqs.filter((r) => P.canPettyCashActOnRequest(u, r)).length,
        ceoApprove: P.isSuperadmin(u) || P.hasRole(u, "CEO"),
        markPaid: P.isSuperadmin(u) || P.hasRole(u, "ACCOUNTING"),
        procurementEdit: P.isSuperadmin(u) || P.hasRole(u, "PROCUREMENT"),
        manageProducts: P.canManageProducts(u),
        setRevenueGoals: RG.canEditRevenueGoals(u),
        canView: reqs.filter((r) => P.canViewRequest(u, r)).length,
      },
      spendScope: (P.isSuperadmin(u) || P.hasRole(u, "CEO") || P.hasRole(u, "ACCOUNTING"))
        ? "everything (role)"
        : P.hasRole(u, "BO") ? "their BO scope"
        : depts.length ? `only ${depts.join(", ")}` : "nothing",
      submitBu: person.bu,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
