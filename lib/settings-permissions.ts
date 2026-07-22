import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import type { CurrentUser } from "@/types/database";
import { ROLES, type Role } from "@/lib/constants";
import {
  canAccessSettingsTab,
  isSuperadmin,
  DEFAULT_SETTINGS_TAB_ROLES,
  MANAGED_SETTINGS_TABS,
  type ManagedSettingsTab,
} from "@/lib/permissions";

// PostgREST's code for "this table isn't in my schema cache" — what you get
// when supabase/migrations/016_settings_tab_permissions.sql hasn't been
// applied yet. Same graceful-degradation convention as
// announcements/calendar_events/companies elsewhere in this app: fall back
// to the OLD hardcoded SETTINGS_TAB_ROLES values (DEFAULT_SETTINGS_TAB_ROLES)
// rather than 500ing the Settings page or every gated API route just
// because this one migration hasn't landed yet.
const TABLE_NOT_FOUND = "PGRST205";

// Fetches the live settings_tab_permissions config, parsed into the same
// Record<ManagedSettingsTab, Role[]> shape canAccessSettingsTab/
// canManageProducts already accept. Any tab missing a DB row (shouldn't
// happen post-migration, but defensively handled) keeps its hardcoded
// default; any unrecognized tab key or Role value in the roles column is
// silently dropped rather than trusted, same "don't trust stored strings
// blindly" caution this app already applies to bu_scope/dept_scope parsing.
export async function getSettingsTabPermissions(): Promise<Record<ManagedSettingsTab, Role[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("settings_tab_permissions").select("tab, roles");
  if (error) {
    if (error.code === TABLE_NOT_FOUND) return DEFAULT_SETTINGS_TAB_ROLES;
    throw error;
  }

  const config = { ...DEFAULT_SETTINGS_TAB_ROLES };
  for (const row of (data ?? []) as { tab: string; roles: string }[]) {
    if (!MANAGED_SETTINGS_TABS.includes(row.tab as ManagedSettingsTab)) continue;
    config[row.tab as ManagedSettingsTab] = row.roles
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Role => (ROLES as readonly string[]).includes(s));
  }
  return config;
}

// Server-side gate for the 8 tabs' mutation routes (POST/PATCH/DELETE),
// replacing each one's previously hardcoded hasAnyRole/isSuperadmin check.
// SUPERADMIN always passes without a DB round-trip; otherwise fetches the
// current config and throws ForbiddenError unless the user holds one of
// that tab's configured roles — delegating to canAccessSettingsTab so the
// "products" tab's extra DEPT_HEAD-scoped-to-R&D carve-out (see
// lib/permissions.ts#canManageProducts) is honored automatically here too,
// with a single source of truth rather than a second copy of that rule.
export async function requireSettingsTabRole(
  user: CurrentUser,
  tab: ManagedSettingsTab,
): Promise<void> {
  if (isSuperadmin(user)) return;
  const config = await getSettingsTabPermissions();
  if (!canAccessSettingsTab(user, tab, config)) throw new ForbiddenError();
}
