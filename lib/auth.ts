import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedDomain } from "@/lib/domain";
import { logAudit } from "@/lib/audit";
import type { CurrentUser, RoleRow } from "@/types/database";

export { isAllowedDomain };

// Exported so /api/roles and /api/roles/[id] (which need the exact same
// three-tier column fallback for their own SELECT/INSERT/UPDATE calls)
// reuse these instead of drifting out of sync with a second copy.
export const LEGACY_ROLE_COLUMNS = "id, email, role, bu_scope, dept_scope, cat_l1_scope";
export const MID_ROLE_COLUMNS = `${LEGACY_ROLE_COLUMNS}, created_at, is_auto_registered`;
export const ROLE_COLUMNS = `${MID_ROLE_COLUMNS}, chapter`;

// Postgrest's "column does not exist" code — thrown if
// supabase/migrations/007_roles_update.sql (adds roles.is_auto_registered)
// and/or 011_chapter.sql (adds roles.chapter) haven't been applied to this
// database yet. See CLAUDE.md "Database Schema": there's no way to run DDL
// from this agent environment, so this code has to ship able to run
// correctly both before and after someone applies either migration by
// hand, in whichever order — not "ship broken until the migration happens
// to land first."
export const UNDEFINED_COLUMN = "42703";

// Fills in the fields a narrower fallback tier below can't select yet, so
// every return path still produces a well-typed RoleRow.
function withDefaults(rows: Record<string, unknown>[], extra: Partial<RoleRow>): RoleRow[] {
  return rows.map((r) => ({ ...r, ...extra })) as RoleRow[];
}

function defaultsFor(columns: string): Partial<RoleRow> {
  if (columns === ROLE_COLUMNS) return {};
  if (columns === MID_ROLE_COLUMNS) return { chapter: null };
  return { created_at: "", is_auto_registered: false, chapter: null };
}

// Tries the full column set first, then progressively narrower fallbacks
// for whichever of migrations 007 (is_auto_registered)/011 (chapter)
// haven't been applied yet — independently, in whichever order someone
// happens to apply them. Returns whichever tier's select actually
// succeeded so the auto-register insert below (which must select back the
// same columns it just wrote) uses a column set guaranteed to exist.
async function selectRolesByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<{ rows: RoleRow[]; columns: string }> {
  for (const columns of [ROLE_COLUMNS, MID_ROLE_COLUMNS, LEGACY_ROLE_COLUMNS]) {
    const { data, error } = await admin.from("roles").select(columns).eq("email", email);
    if (!error) {
      return { rows: withDefaults((data ?? []) as unknown as Record<string, unknown>[], defaultsFor(columns)), columns };
    }
    if (error.code !== UNDEFINED_COLUMN) {
      throw new Error(`Failed to load roles for ${email}: ${error.message}`);
    }
  }
  throw new Error(`Failed to load roles for ${email}: legacy column set also failed`);
}

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

  const admin = createAdminClient();
  const { rows, columns } = await selectRolesByEmail(admin, user.email);
  let allRoles = rows;

  // First-ever sign-in for this @mimetta.co address — no roles row exists.
  // Auto-register as EMPLOYEE (the baseline every signed-in user already
  // gets — Submit + My Requests, see lib/permissions.ts#canAccessPage)
  // rather than leaving them authenticated with literally zero pages
  // available until an admin notices and adds them manually. `.upsert()`
  // against the table's existing unique constraint (email, role, bu_scope,
  // dept_scope, cat_l1_scope) — rather than a plain `.insert()` — makes
  // this race-safe: a first-time visit typically fires several parallel
  // requireUser() calls at once (the page itself plus its client-side
  // fetches), and without this they'd all see "no roles" simultaneously and
  // race to insert. On conflict this just re-writes the identical row and
  // returns it, so it's a harmless no-op either way.
  if (allRoles.length === 0) {
    const insertPayload: Record<string, unknown> = {
      email: user.email,
      role: "EMPLOYEE",
      bu_scope: "*",
      dept_scope: "*",
      cat_l1_scope: "*",
    };
    // Only set if this tier's column actually exists — see selectRolesByEmail.
    if (columns !== LEGACY_ROLE_COLUMNS) insertPayload.is_auto_registered = true;

    const { data: inserted, error: insertError } = await admin
      .from("roles")
      .upsert(insertPayload, { onConflict: "email,role,bu_scope,dept_scope,cat_l1_scope" })
      .select(columns)
      .single();

    if (insertError) {
      throw new Error(`Failed to auto-register ${user.email}: ${insertError.message}`);
    }

    allRoles = withDefaults([inserted as unknown as Record<string, unknown>], defaultsFor(columns));
    await logAudit(user.email, null, "AUTO_REGISTERED", { role: "EMPLOYEE" });
  }

  return {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
    allRoles,
    // Multi-role users can in principle have different chapter values per
    // row (chapter isn't scoped like bu_scope/dept_scope) — first non-empty
    // one wins, same "first match" convention canBoActOnRequest-adjacent
    // logic elsewhere in this file's callers already uses.
    chapter: allRoles.map((r) => r.chapter).find((c) => !!c?.trim()) ?? null,
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
