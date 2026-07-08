import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedDomain } from "@/lib/domain";
import type { CurrentUser, RoleRow } from "@/types/database";

export { isAllowedDomain };

// Resolves the signed-in user from the request's Supabase session and loads
// every roles row for their email. Returns null if there is no session or
// the session's email is not on the @mimetta.co workspace domain.
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
    .select("id, email, role, bu_scope, dept_scope, cat_l1_scope")
    .eq("email", user.email);

  if (error) {
    throw new Error(`Failed to load roles for ${user.email}: ${error.message}`);
  }

  return {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
    allRoles: (roles ?? []) as RoleRow[],
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
