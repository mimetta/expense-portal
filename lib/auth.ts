import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedDomain } from "@/lib/domain";
import { logAudit } from "@/lib/audit";
import type { CurrentUser, RoleRow } from "@/types/database";

export { isAllowedDomain };

const LEGACY_ROLE_COLUMNS = "id, email, role, bu_scope, dept_scope, cat_l1_scope";
const ROLE_COLUMNS = `${LEGACY_ROLE_COLUMNS}, created_at, is_auto_registered`;

// Postgrest's "column does not exist" code — thrown if
// supabase/migrations/007_roles_update.sql (adds roles.is_auto_registered)
// hasn't been applied to this database yet. See CLAUDE.md "Database
// Schema": there's no way to run DDL from this agent environment, so this
// code has to ship able to run correctly both before and after someone
// applies it by hand — not "ship broken until the migration happens to
// land first."
const UNDEFINED_COLUMN = "42703";

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
  const { data: roles, error } = await admin
    .from("roles")
    .select(ROLE_COLUMNS)
    .eq("email", user.email);

  if (error) {
    if (error.code === UNDEFINED_COLUMN) {
      // Migration 007 isn't applied yet — fall back to the pre-007 column
      // set so sign-in (and everything else) keeps working exactly as
      // before this batch. Auto-registration, the yellow banner, and the
      // Pending Users badge are simply unavailable until it's applied;
      // nothing here needs to change once it is — the primary select above
      // will just stop erroring and this whole branch stops being reached.
      const fallback = await admin.from("roles").select(LEGACY_ROLE_COLUMNS).eq("email", user.email);
      if (fallback.error) {
        throw new Error(`Failed to load roles for ${user.email}: ${fallback.error.message}`);
      }
      return {
        email: user.email,
        name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
        allRoles: (fallback.data ?? []).map((r) => ({
          ...r,
          created_at: "",
          is_auto_registered: false,
        })) as RoleRow[],
      };
    }
    throw new Error(`Failed to load roles for ${user.email}: ${error.message}`);
  }

  let allRoles = (roles ?? []) as RoleRow[];

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
    const { data: inserted, error: insertError } = await admin
      .from("roles")
      .upsert(
        {
          email: user.email,
          role: "EMPLOYEE",
          bu_scope: "*",
          dept_scope: "*",
          cat_l1_scope: "*",
          is_auto_registered: true,
        },
        { onConflict: "email,role,bu_scope,dept_scope,cat_l1_scope" },
      )
      .select(ROLE_COLUMNS)
      .single();

    if (insertError) {
      throw new Error(`Failed to auto-register ${user.email}: ${insertError.message}`);
    }

    allRoles = [inserted as RoleRow];
    await logAudit(user.email, null, "AUTO_REGISTERED", { role: "EMPLOYEE" });
  }

  return {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
    allRoles,
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
