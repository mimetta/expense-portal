import { NextResponse } from "next/server";
import { requireUser, UNDEFINED_COLUMN } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";
import { ROLES, type Role } from "@/lib/constants";

interface UpdateRoleBody {
  email?: string;
  role?: Role;
  bu_scope?: string;
  dept_scope?: string;
  cat_l1_scope?: string;
  chapter?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "users");

    const { id } = await params;
    const body = (await request.json()) as UpdateRoleBody;
    if (body.role && !ROLES.includes(body.role)) {
      return NextResponse.json({ error: "role must be one of: " + ROLES.join(", ") }, { status: 400 });
    }

    const admin = createAdminClient();
    const bodyWithoutChapter: Omit<UpdateRoleBody, "chapter"> = {
      email: body.email,
      role: body.role,
      bu_scope: body.bu_scope,
      dept_scope: body.dept_scope,
      cat_l1_scope: body.cat_l1_scope,
    };

    // Any admin edit — even just tweaking a scope — counts as "this role
    // has now been reviewed", so it clears the auto-registered flag and
    // the yellow "not yet assigned" banner (components/Nav.tsx) for this
    // user. This is also what the Pending Users "Assign Role" button does,
    // since it opens this same edit modal/PATCH.
    //
    // Three tiers for whichever of migrations 007 (is_auto_registered)/011
    // (chapter) haven't been applied yet, same ordering assumption
    // (applied roughly in numeric order) as lib/auth.ts's own three-tier
    // fallback: full -> without chapter -> without chapter or
    // is_auto_registered.
    let data, error;
    ({ data, error } = await admin
      .from("roles")
      .update({ ...body, is_auto_registered: false })
      .eq("id", id)
      .select()
      .single());
    if (error?.code === UNDEFINED_COLUMN) {
      ({ data, error } = await admin
        .from("roles")
        .update({ ...bodyWithoutChapter, is_auto_registered: false })
        .eq("id", id)
        .select()
        .single());
    }
    if (error?.code === UNDEFINED_COLUMN) {
      ({ data, error } = await admin.from("roles").update(bodyWithoutChapter).eq("id", id).select().single());
      if (!error) {
        return NextResponse.json({ role: { ...data, is_auto_registered: false } });
      }
    }
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
    await requireSettingsTabRole(user, "users");

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("roles").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
