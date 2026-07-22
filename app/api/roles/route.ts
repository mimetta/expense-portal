import { NextResponse } from "next/server";
import {
  requireUser,
  LEGACY_ROLE_COLUMNS,
  MID_ROLE_COLUMNS,
  ROLE_COLUMNS,
  UNDEFINED_COLUMN,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";
import { isAllowedDomain } from "@/lib/domain";
import { ROLES, type Role } from "@/lib/constants";

function defaultsFor(columns: string) {
  if (columns === ROLE_COLUMNS) return {};
  if (columns === MID_ROLE_COLUMNS) return { chapter: null };
  return { created_at: "", is_auto_registered: false, chapter: null };
}

// Every role row (a user may hold several — see CLAUDE.md multi-role notes).
// Readable by any signed-in user: Settings > User Management needs the full
// list, and /submit's Slip Payment Receiver picker needs the email list.
// Mutations are SUPERADMIN-only.
export async function GET(request: Request) {
  try {
    await requireUser();
    const admin = createAdminClient();

    // Settings > User Management's Chapter combobox needs the distinct set
    // of chapters already in use, to populate as dropdown options (still
    // allowing free-text entry of a new one client-side). Degrades to an
    // empty list rather than 500ing if migrations/011_chapter.sql hasn't
    // been applied yet, same graceful-degradation convention as the rest of
    // this route.
    const { searchParams } = new URL(request.url);
    if (searchParams.get("distinct") === "chapter") {
      const { data, error } = await admin.from("roles").select("chapter");
      if (error) {
        if (error.code === UNDEFINED_COLUMN) return NextResponse.json({ chapters: [] });
        throw error;
      }
      const chapters = Array.from(
        new Set((data ?? []).map((r) => (r as { chapter: string | null }).chapter).filter((c): c is string => !!c)),
      ).sort();
      return NextResponse.json({ chapters });
    }

    // Same three-tier fallback as lib/auth.ts#selectRolesByEmail (for
    // whichever of migrations 007/011 haven't been applied yet) — this
    // endpoint feeds the Slip Payment Receiver picker on /submit/etc., not
    // just Settings > User Management, so it needs to degrade the same way
    // rather than 500ing app-wide.
    for (const columns of [ROLE_COLUMNS, MID_ROLE_COLUMNS, LEGACY_ROLE_COLUMNS]) {
      const { data, error } = await admin.from("roles").select(columns).order("email");
      if (!error) {
        const extra = defaultsFor(columns);
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        return NextResponse.json({ roles: rows.map((r) => ({ ...r, ...extra })) });
      }
      if (error.code !== UNDEFINED_COLUMN) throw error;
    }
    throw new Error("Failed to load roles: legacy column set also failed");
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
  chapter?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "users");

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
    const basePayload = {
      email: body.email,
      role: body.role,
      bu_scope: body.bu_scope ?? "*",
      dept_scope: body.dept_scope ?? "*",
      cat_l1_scope: body.cat_l1_scope ?? "*",
    };

    let data, error;
    ({ data, error } = await admin
      .from("roles")
      .insert({ ...basePayload, chapter: body.chapter?.trim() || null })
      .select()
      .single());
    if (error?.code === UNDEFINED_COLUMN) {
      // migrations/011_chapter.sql not applied yet — same silent retry
      // convention as POST /api/requests, not a 500/503, since Add User is
      // the primary way to grant a new @mimetta.co address any access at
      // all and shouldn't be blocked by an optional field's column.
      ({ data, error } = await admin.from("roles").insert(basePayload).select().single());
    }
    if (error) throw error;
    return NextResponse.json({ role: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
