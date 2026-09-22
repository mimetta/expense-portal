import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { PersonV2, RoleV2 } from "@/lib/access-v2";
import type { RoleRow } from "@/types/database";

// Stage 2b: loading a person from the NEW tables.
//
// `roles` and settings_tab_permissions still exist, untouched, as the
// rollback path — reverting the switch-over commit restores them as the
// source of truth with no data migration.

/**
 * Projects a PersonV2 into the `allRoles` shape the rest of the app already
 * reads, so hasRole/rolesOf/canBoActOnRequest keep working unchanged against
 * the new tables. BO emits ONE synthetic row per bo_scopes entry, which is
 * exactly how several BO rows behaved before — rolesOf(user,"BO").some(...)
 * therefore ORs across scopes as it always did.
 */
export function projectAllRoles(p: PersonV2): RoleRow[] {
  const rows: RoleRow[] = [];
  for (const role of p.roles) {
    if (role === "BO" && p.boScopes.length > 0) {
      for (const s of p.boScopes) {
        rows.push({
          id: `${p.email}|BO`, email: p.email, role,
          bu_scope: s.bu_scope, dept_scope: s.dept_scope, cat_l1_scope: s.cat_l1_scope,
          created_at: "", is_auto_registered: false, chapter: null,
          department: p.visible_departments,
        } as RoleRow);
        }
      continue;
    }
    rows.push({
      id: `${p.email}|${role}`, email: p.email, role,
      // Scope on a non-BO row is meaningless in v2 and is not carried: the
      // only consumer was resolvedBu, now people.bu.
      bu_scope: "*", dept_scope: "*", cat_l1_scope: "*",
      created_at: "", is_auto_registered: false, chapter: null,
      department: p.visible_departments,
    } as RoleRow);
  }
  return rows;
}

/** Loads one person and everything attached to them. Null if no row. */
export async function loadPerson(email: string): Promise<PersonV2 | null> {
  const admin = createAdminClient();
  const [{ data: person }, { data: roles }, { data: scopes }, { data: overrides }] = await Promise.all([
    admin.from("people").select("*").eq("email", email).maybeSingle(),
    admin.from("person_roles").select("role").eq("email", email),
    admin.from("bo_scopes").select("bu_scope, dept_scope, cat_l1_scope").eq("email", email),
    admin.from("person_menu_overrides").select("menu, allowed").eq("email", email),
  ]);
  if (!person) return null;
  return {
    email: person.email as string,
    bu: person.bu as PersonV2["bu"],
    bu_defaulted: !!person.bu_defaulted,
    visible_departments: String(person.visible_departments ?? ""),
    chapter: (person.chapter as string | null) ?? null,
    roles: (roles ?? []).map((r) => r.role as RoleV2),
    boScopes: (scopes ?? []) as PersonV2["boScopes"],
    overrides: Object.fromEntries((overrides ?? []).map((o) => [o.menu as string, !!o.allowed])),
  };
}

/**
 * First-ever sign-in: create the person with EMPLOYEE, BU defaulted to ONEST
 * and FLAGGED, so an admin confirms it rather than inheriting a guess. Same
 * intent as the old roles auto-registration, against the new tables.
 *
 * Upsert with ignoreDuplicates, not insert: a first page load fires several
 * parallel requireUser() calls that would otherwise race.
 */
export async function autoRegisterPerson(email: string): Promise<PersonV2> {
  const admin = createAdminClient();
  const { error: pErr } = await admin
    .from("people")
    .upsert({ email, bu: "ONEST", bu_defaulted: true, visible_departments: "", is_auto_registered: true },
            { onConflict: "email", ignoreDuplicates: true });
  if (pErr) throw new Error(`Failed to auto-register ${email}: ${pErr.message}`);
  const { error: rErr } = await admin
    .from("person_roles")
    .upsert({ email, role: "EMPLOYEE" }, { onConflict: "email,role", ignoreDuplicates: true });
  if (rErr) throw new Error(`Failed to auto-register ${email}: ${rErr.message}`);
  await logAudit(email, null, "AUTO_REGISTERED", { role: "EMPLOYEE", bu: "ONEST", bu_defaulted: true });
  const p = await loadPerson(email);
  if (!p) throw new Error(`Auto-registration of ${email} produced no row`);
  return p;
}
