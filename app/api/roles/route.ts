import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { isAllowedDomain } from "@/lib/domain";
import { ROLES, type Role } from "@/lib/constants";

// Every role row (a user may hold several — see CLAUDE.md multi-role notes).
// Readable by any signed-in user: Settings > User Management needs the full
// list, and /submit's Slip Payment Receiver picker needs the email list.
// Mutations are SUPERADMIN-only.
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("roles")
      .select("id, email, role, bu_scope, dept_scope, cat_l1_scope")
      .order("email");
    if (error) throw error;
    return NextResponse.json({ roles: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateRoleBody {
  email: string;
  role: Role;
  bu_scope?: string;
  dept_scope?: string;
  cat_l1_scope?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const body = (await request.json()) as CreateRoleBody;
    if (!body.email || !isAllowedDomain(body.email)) {
      return NextResponse.json(
        { error: "email is required and must be on the @mimetta.co domain" },
        { status: 400 },
      );
    }
    if (!body.role || !ROLES.includes(body.role)) {
      return NextResponse.json({ error: "role must be one of: " + ROLES.join(", ") }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("roles")
      .insert({
        email: body.email,
        role: body.role,
        bu_scope: body.bu_scope ?? "*",
        dept_scope: body.dept_scope ?? "*",
        cat_l1_scope: body.cat_l1_scope ?? "*",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ role: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
