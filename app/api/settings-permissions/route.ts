import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { FREE_MENU_DEFAULTS } from "@/lib/access-v2";
import { canAccessPage, isSuperadmin } from "@/lib/permissions";

// PostgREST's code for "this table isn't in my schema cache" — what you get
// before supabase/migrations/024_settings_tab_permissions.sql has been
// applied. Same code every other not-yet-applied-migration route in this
// app checks (announcements/calendar_events/companies).

// Readable by any signed-in user who can reach /settings at all (any role
// except a pure EMPLOYEE) — settingsClient.tsx needs this to compute which
// tabs to show for the signed-in user, the same way it already reads
// suppliers/products/categories as open reference data. Mutating it
// (PATCH below) is SUPERADMIN-only.
export async function GET() {
  try {
    const user = await requireUser();
    if (!canAccessPage(user, "settings")) throw new ForbiddenError();
    // STAGE 2b: report the defaults actually in force (code), not the stale
    // table, so the Permissions tab cannot show a configuration that no
    // longer decides anything.
    const permissions = Object.fromEntries(
      Object.entries(FREE_MENU_DEFAULTS)
        .filter(([m]) => m.startsWith("settings."))
        .map(([m, roles]) => [m.slice("settings.".length), roles]),
    );
    return NextResponse.json({ permissions });
  } catch (err) {
    return handleApiError(err);
  }
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
    await request.json().catch(() => ({}));

    // STAGE 2b: DISABLED, deliberately.
    //
    // settings_tab_permissions is no longer read by anything —
    // canAccessSettingsTab delegates to lib/access-v2.ts, which uses role
    // defaults in code plus per-person overrides. Accepting a write here
    // would store a value nobody consults, so an admin would change a
    // permission, see it saved, and have nothing happen. Refusing is the
    // honest failure.
    //
    // The table itself is untouched and still holds its pre-switch rows, so
    // reverting the stage 2b commit restores this endpoint's effect exactly.
    return NextResponse.json(
      {
        error:
          "Tab permissions are no longer configured per role. Role defaults live in code " +
          "(lib/access-v2.ts) and exceptions are set per person in Settings > People & departments.",
      },
      { status: 410 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

