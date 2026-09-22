import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";
import { isAllowedDomain } from "@/lib/domain";
import { ROLES_V2, type RoleV2Name, synthRows, personRowsFor } from "@/lib/roles-compat";

// STAGE 2b: backed by `people` / `person_roles` / `bo_scopes`, NOT the legacy
// `roles` table. The request and response shapes are unchanged so Settings >
// User Management and /submit's Slip Receiver picker keep working; each
// synthetic row's `id` is `email|ROLE`, which is the real primary key of
// person_roles.
//
// The legacy table is deliberately left in place, unread and unwritten, as
// the rollback path.

export async function GET(request: Request) {
  try {
    await requireUser();
    const admin = createAdminClient();

    const { searchParams } = new URL(request.url);
    if (searchParams.get("distinct") === "chapter") {
      const { data, error } = await admin.from("people").select("chapter");
      if (error) return NextResponse.json({ chapters: [] });
      const chapters = Array.from(
        new Set((data ?? []).map((r) => String(r.chapter ?? "").trim()).filter(Boolean)),
      ).sort();
      return NextResponse.json({ chapters });
    }

    return NextResponse.json({ roles: await synthRows(admin) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "users");
    const body = (await request.json()) as {
      email?: string; role?: string; bu_scope?: string; dept_scope?: string;
      cat_l1_scope?: string; chapter?: string; department?: string; bu?: string;
    };

    if (!body.email || !isAllowedDomain(body.email)) {
      return NextResponse.json(
        { error: "email is required and must be on the @mimetta.co domain" },
        { status: 400 },
      );
    }
    if (!body.role || !ROLES_V2.includes(body.role as RoleV2Name)) {
      return NextResponse.json(
        { error: "role must be one of: " + ROLES_V2.join(", ") },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const email = body.email.trim().toLowerCase();

    // The person may already exist (adding a second role). Only create the
    // people row if missing — and default the BU flagged, so it is confirmed
    // rather than inherited, exactly as auto-registration does.
    const { data: existing } = await admin.from("people").select("email").eq("email", email).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("people").insert({
        email,
        bu: body.bu === "SV" || body.bu === "BOTH" ? body.bu : "ONEST",
        bu_defaulted: !body.bu,
        visible_departments: body.department?.trim() ?? "",
        chapter: body.chapter?.trim() || null,
      });
      if (error) throw error;
    } else if (body.chapter?.trim() || body.department !== undefined) {
      const patch: Record<string, unknown> = {};
      if (body.chapter?.trim()) patch.chapter = body.chapter.trim();
      if (body.department !== undefined) patch.visible_departments = body.department.trim();
      await admin.from("people").update(patch).eq("email", email);
    }

    const { error: rErr } = await admin
      .from("person_roles")
      .upsert({ email, role: body.role }, { onConflict: "email,role", ignoreDuplicates: true });
    if (rErr) throw rErr;

    // Scope belongs to BO ownership only; it is ignored for every other role.
    if (body.role === "BO") {
      const { error: sErr } = await admin.from("bo_scopes").upsert(
        {
          email,
          bu_scope: body.bu_scope ?? "*",
          dept_scope: body.dept_scope ?? "*",
          cat_l1_scope: body.cat_l1_scope ?? "*",
        },
        { onConflict: "email,bu_scope,dept_scope,cat_l1_scope", ignoreDuplicates: true },
      );
      if (sErr) throw sErr;
    }

    const rows = await personRowsFor(admin, email);
    return NextResponse.json({ role: rows.find((r) => r.role === body.role) ?? rows[0] }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
