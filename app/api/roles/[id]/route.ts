import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { ROLES, type Role } from "@/lib/constants";

interface UpdateRoleBody {
  email?: string;
  role?: Role;
  bu_scope?: string;
  dept_scope?: string;
  cat_l1_scope?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const { id } = await params;
    const body = (await request.json()) as UpdateRoleBody;
    if (body.role && !ROLES.includes(body.role)) {
      return NextResponse.json({ error: "role must be one of: " + ROLES.join(", ") }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("roles")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ role: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("roles").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
