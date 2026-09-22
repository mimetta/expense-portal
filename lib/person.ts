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
    active: person.active !== false,
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
/**
 * Thrown when a deactivated person tries to sign in. Distinct from "no such
 * person", which auto-registers.
 */
export class DeactivatedPersonError extends Error {
  constructor(email: string) {
    super(`${email} has been deactivated in the expense portal.`);
    this.name = "DeactivatedPersonError";
  }
}

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
  // Same shape as PERSON_ACCESS_UPDATED so the two read alike in the log.
  // The actor is the person themselves: this is triggered by their own first
  // sign-in, not by an admin.
  await logAudit(email, null, "AUTO_REGISTERED", {
    email,
    from: { roles: [], bu: null, bu_defaulted: null, visible_departments: null, boScopes: [], overrides: [] },
    to: { roles: ["EMPLOYEE"], bu: "ONEST", bu_defaulted: true, visible_departments: "", boScopes: [], overrides: [] },
  });
  const p = await loadPerson(email);
  if (!p) throw new Error(`Auto-registration of ${email} produced no row`);
  return p;
}

/**
 * Emails of ACTIVE people holding any of these roles. The single source for
 * "who should appear in a picker / get notified / own a budget" — a
 * deactivated person must vanish from all of them, and doing the filter per
 * call site guarantees one gets missed.
 */
export async function activeEmailsWithRole(roles: string[]): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: pr }, { data: people }] = await Promise.all([
    admin.from("person_roles").select("email, role").in("role", roles),
    admin.from("people").select("email, active"),
  ]);
  const inactive = new Set((people ?? []).filter((p) => p.active === false).map((p) => p.email as string));
  return Array.from(new Set((pr ?? []).map((r) => r.email as string).filter((e) => !inactive.has(e))));
}
