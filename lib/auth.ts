import { createClient } from "@/lib/supabase/server";
import { isAllowedDomain } from "@/lib/domain";
import type { CurrentUser } from "@/types/database";
import { loadPerson, autoRegisterPerson, projectAllRoles } from "@/lib/person";

export { isAllowedDomain };

// Exported so /api/roles and /api/roles/[id] (which need the exact same
// three-tier column fallback for their own SELECT/INSERT/UPDATE calls)
// reuse these instead of drifting out of sync with a second copy.
export const LEGACY_ROLE_COLUMNS = "id, email, role, bu_scope, dept_scope, cat_l1_scope";
export const MID_ROLE_COLUMNS = `${LEGACY_ROLE_COLUMNS}, created_at, is_auto_registered`;
export const ROLE_COLUMNS = `${MID_ROLE_COLUMNS}, chapter`;
// Migration 034. A fourth tier rather than widening ROLE_COLUMNS, so a
// database without 034 still signs people in — same reasoning as 007/011.
export const FULL_ROLE_COLUMNS = `${ROLE_COLUMNS}, department`;

// Postgrest's "column does not exist" code — thrown if
// supabase/migrations/007_roles_update.sql (adds roles.is_auto_registered)
// and/or 011_chapter.sql (adds roles.chapter) haven't been applied to this
// database yet. See CLAUDE.md "Database Schema": there's no way to run DDL
// from this agent environment, so this code has to ship able to run
// correctly both before and after someone applies either migration by
// hand, in whichever order — not "ship broken until the migration happens
// to land first."
export const UNDEFINED_COLUMN = "42703";

// The three-tier roles column fallback and selectRolesByEmail were removed
// in stage 2b: identity comes from `people` now, so there is no roles SELECT
// left to fall back through. The column constants above are still exported
// because scripts/migrate-from-sheets.ts references the legacy shape.

// Resolves the signed-in user from the request's Supabase session and loads
// every roles row for their email. Returns null if there is no session or
// the session's email is not on the @mimetta.co workspace domain — the
// "reject non-@mimetta.co accounts" behavior this implies was already in
// place before this function grew auto-registration below; every caller
// (middleware, page.tsx guards, app/auth/callback/route.ts) already treats
// a null return as sign-in failure.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedDomain(user.email)) {
    return null;
  }

  // STAGE 2b: identity now comes from `people` / `person_roles` / `bo_scopes`
  // / `person_menu_overrides`. The legacy `roles` table is no longer read —
  // it is left intact purely as the rollback path.
  const person = (await loadPerson(user.email)) ?? (await autoRegisterPerson(user.email));

  return {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
    // A projection of the new tables, so every hasRole/rolesOf caller keeps
    // working unchanged. See lib/person.ts#projectAllRoles.
    allRoles: projectAllRoles(person),
    chapter: person.chapter ?? null,
    person,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
