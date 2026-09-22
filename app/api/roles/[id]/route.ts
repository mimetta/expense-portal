import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";
import { ROLES_V2, type RoleV2Name, parseRowId, personRowsFor } from "@/lib/roles-compat";

// STAGE 2b: writes to `people` / `person_roles` / `bo_scopes`. The legacy
// `roles` table is no longer written — leaving a write pointed at a table
// nothing reads would make every edit silently vanish.
//
// `id` is `email|ROLE` (see lib/roles-compat.ts).

interface Body {
  role?: string;
  bu_scope?: string;
  dept_scope?: string;
  cat_l1_scope?: string;
  chapter?: string | null;
  department?: string;
  bu?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "users");
    const { id } = await params;
    const key = parseRowId(decodeURIComponent(id));
    if (!key) return NextResponse.json({ error: "Unrecognised row id" }, { status: 400 });

    const body = (await req.json()) as Body;
    const admin = createAdminClient();
    const { email } = key;

    // Person-level fields.
    const personPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.chapter !== undefined) personPatch.chapter = body.chapter?.trim() || null;
    if (body.department !== undefined) personPatch.visible_departments = body.department.trim();
    if (body.bu === "ONEST" || body.bu === "SV" || body.bu === "BOTH") {
      personPatch.bu = body.bu;
      // An explicit choice is no longer a default.
      personPatch.bu_defaulted = false;
    }
    // An admin has now looked at this person.
    personPatch.is_auto_registered = false;
    const { error: pErr } = await admin.from("people").update(personPatch).eq("email", email);
    if (pErr) throw pErr;

    // Role change: person_roles' PK is (email, role), so this is a
    // delete-then-insert rather than an update of the key.
    const nextRole = body.role && ROLES_V2.includes(body.role as RoleV2Name) ? body.role : key.role;
    if (nextRole !== key.role) {
      await admin.from("person_roles").delete().eq("email", email).eq("role", key.role);
      const { error } = await admin
        .from("person_roles")
        .upsert({ email, role: nextRole }, { onConflict: "email,role", ignoreDuplicates: true });
      if (error) throw error;
      // Scope is meaningless once the role is not BO.
      if (key.role === "BO" && nextRole !== "BO") {
        await admin.from("bo_scopes").delete().eq("email", email);
      }
    }

    if (nextRole === "BO" && (body.bu_scope || body.dept_scope || body.cat_l1_scope)) {
      // The UI edits one scope row at a time; replacing the set keeps the
      // stored scopes exactly what the form shows.
      await admin.from("bo_scopes").delete().eq("email", email);
      const { error } = await admin.from("bo_scopes").insert({
        email,
        bu_scope: body.bu_scope ?? "*",
        dept_scope: body.dept_scope ?? "*",
        cat_l1_scope: body.cat_l1_scope ?? "*",
      });
      if (error) throw error;
    }

    const rows = await personRowsFor(admin, email);
    return NextResponse.json({ role: rows.find((r) => r.role === nextRole) ?? rows[0] ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "users");
    const { id } = await params;
    const key = parseRowId(decodeURIComponent(id));
    if (!key) return NextResponse.json({ error: "Unrecognised row id" }, { status: 400 });

    const admin = createAdminClient();
    const { error } = await admin
      .from("person_roles")
      .delete()
      .eq("email", key.email)
      .eq("role", key.role);
    if (error) throw error;
    if (key.role === "BO") await admin.from("bo_scopes").delete().eq("email", key.email);

    // The people row is deliberately kept when the last role goes: it still
    // carries the person's BU and spend-report visibility, and deleting it
    // would cascade those away. A person with no roles simply has none.
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
