import type { RoleRow } from "@/types/database";
import type { createAdminClient } from "@/lib/supabase/admin";

// Stage 2b: presents the new `people` / `person_roles` / `bo_scopes` tables
// in the row shape Settings > User Management and the Slip Receiver picker
// already consume, so the switch-over does not require rewriting that UI in
// the same commit. `id` is `email|ROLE` — the real composite key of
// person_roles, so PATCH/DELETE can address a row without a surrogate.

export const ROLES_V2 = [
  "SUPERADMIN", "CEO", "ACCOUNTING", "BO",
  "PROCUREMENT", "PETTY_CASH_CUSTODIAN", "EMPLOYEE",
] as const;
export type RoleV2Name = (typeof ROLES_V2)[number];

type Admin = ReturnType<typeof createAdminClient>;

export const rowId = (email: string, role: string) => `${email}|${role}`;
export function parseRowId(id: string): { email: string; role: string } | null {
  const i = id.lastIndexOf("|");
  if (i < 1) return null;
  return { email: id.slice(0, i), role: id.slice(i + 1) };
}

function build(
  email: string, role: string,
  person: { chapter?: unknown; visible_departments?: unknown; bu?: unknown; bu_defaulted?: unknown; is_auto_registered?: unknown; created_at?: unknown },
  scopes: { bu_scope: string; dept_scope: string; cat_l1_scope: string }[],
): RoleRow[] {
  const base = {
    id: rowId(email, role), email, role,
    created_at: String(person.created_at ?? ""),
    is_auto_registered: !!person.is_auto_registered,
    chapter: (person.chapter as string | null) ?? null,
    department: String(person.visible_departments ?? ""),
  };
  // A BO with several scopes shows as several rows, as it always did.
  if (role === "BO" && scopes.length > 0) {
    return scopes.map((s) => ({ ...base, ...s }) as RoleRow);
  }
  return [{ ...base, bu_scope: "*", dept_scope: "*", cat_l1_scope: "*" } as RoleRow];
}

/**
 * ACTIVE people only. This is the directory every picker, notification
 * recipient list and budget-owner lookup reads, so filtering here removes a
 * deactivated person from all of them at once rather than at each call site,
 * where one would eventually be missed. Pass includeInactive for the admin
 * screen, which must still show them.
 */
export async function synthRows(admin: Admin, includeInactive = false): Promise<RoleRow[]> {
  const [{ data: allPeople }, { data: roles }, { data: scopes }] = await Promise.all([
    admin.from("people").select("*"),
    admin.from("person_roles").select("email, role"),
    admin.from("bo_scopes").select("email, bu_scope, dept_scope, cat_l1_scope"),
  ]);
  const people = includeInactive
    ? (allPeople ?? [])
    : (allPeople ?? []).filter((p) => p.active !== false);
  const out: RoleRow[] = [];
  for (const r of roles ?? []) {
    const p = people.find((x) => x.email === r.email);
    if (!p) continue;
    out.push(...build(r.email as string, r.role as string, p,
      (scopes ?? []).filter((s) => s.email === r.email) as never));
  }
  return out.sort((a, b) => a.email.localeCompare(b.email) || a.role.localeCompare(b.role));
}

export async function personRowsFor(admin: Admin, email: string): Promise<RoleRow[]> {
  return (await synthRows(admin)).filter((r) => r.email === email);
}
