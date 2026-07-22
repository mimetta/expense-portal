import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage, isSuperadmin, MANAGED_SETTINGS_TABS, type ManagedSettingsTab } from "@/lib/permissions";
import { getSettingsTabPermissions } from "@/lib/settings-permissions";
import { ROLES, type Role } from "@/lib/constants";

// PostgREST's code for "this table isn't in my schema cache" — what you get
// before supabase/migrations/016_settings_tab_permissions.sql has been
// applied. Same code every other not-yet-applied-migration route in this
// app checks (announcements/calendar_events/companies).
const TABLE_NOT_FOUND = "PGRST205";

// Readable by any signed-in user who can reach /settings at all (any role
// except a pure EMPLOYEE) — settingsClient.tsx needs this to compute which
// tabs to show for the signed-in user, the same way it already reads
// suppliers/products/categories as open reference data. Mutating it
// (PATCH below) is SUPERADMIN-only.
export async function GET() {
  try {
    const user = await requireUser();
    if (!canAccessPage(user, "settings")) throw new ForbiddenError();
    const permissions = await getSettingsTabPermissions();
    return NextResponse.json({ permissions });
  } catch (err) {
    return handleApiError(err);
  }
}

interface UpdatePermissionBody {
  tab?: string;
  roles?: string[];
}

// SUPERADMIN-only — backs the new Settings > Permissions tab. Saves the
// full role list for exactly one tab per call (settingsClient.tsx's
// PermissionsTab fires one PATCH per toggle-button click). "permissions"
// itself is rejected outright — it's SUPERADMIN-only and hardcoded in
// lib/permissions.ts#canAccessSettingsTab, deliberately not configurable
// through itself (see the migration's own comment for why).
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const body = (await request.json()) as UpdatePermissionBody;
    if (!body.tab || !MANAGED_SETTINGS_TABS.includes(body.tab as ManagedSettingsTab)) {
      return NextResponse.json(
        { error: "tab must be one of: " + MANAGED_SETTINGS_TABS.join(", ") },
        { status: 400 },
      );
    }
    const roles = Array.isArray(body.roles)
      ? body.roles.filter(
          (r): r is Role => (ROLES as readonly string[]).includes(r) && r !== "SUPERADMIN" && r !== "EMPLOYEE",
        )
      : [];

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("settings_tab_permissions")
      .upsert({ tab: body.tab, roles: roles.join(",") }, { onConflict: "tab" })
      .select()
      .single();

    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json(
          { error: "Migration 016_settings_tab_permissions.sql hasn't been applied yet" },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({ permission: data });
  } catch (err) {
    return handleApiError(err);
  }
}
