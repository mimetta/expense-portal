import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
// PAGES is exported from lib/permissions.ts and derived from an exhaustive
// Record<Page, true>, so it can never again drift out of sync with the Page
// union — a page missing here is invisible in the nav with no error at all.
import {
  canAccessPage, PAGES, canManageRevenueChannels,
  SETTINGS_TABS, canAccessSettingsTab, type SettingsTab,
} from "@/lib/permissions";
import { pendingBudgetApprovals } from "@/lib/budget-editor";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const access = Object.fromEntries(PAGES.map((p) => [p, canAccessPage(user, p)]));

    // Counted here rather than from a second endpoint: Nav already calls this
    // on mount and is the only consumer of the badge, so this avoids a second
    // round trip on every page load. It is 0 for anyone who cannot approve.
    const badges = { budget: access.budget ? await pendingBudgetApprovals(user) : 0 };

    return NextResponse.json({
      user: {
        email: user.email, name: user.name, allRoles: user.allRoles, chapter: user.chapter,
        // STAGE 2b: the submit form reads this instead of scanning bu_scope.
        bu: user.person?.bu ?? null,
        buDefaulted: user.person?.bu_defaulted ?? false,
      },
      access,
      badges,
      // Non-page permissions the UI needs to hide a control. The server still
      // enforces each one on write — see app/api/revenue/channels/route.ts.
      menus: { "revenue.channels": canManageRevenueChannels(user) },
      // WHICH SETTINGS TABS THIS PERSON MAY SEE, DECIDED HERE.
      //
      // The client used to recompute this with canAccessSettingsTab. That
      // function takes the override-aware path only when `user.person` is
      // present — and `person` is NOT serialised in the payload above, so in
      // the browser it silently fell through to the legacy ROLE-ONLY branch.
      // Overrides were therefore honoured by the page gate (which runs on the
      // server) and ignored by the tab list, so someone whose only Settings
      // access came from an override reached the page and saw
      // "You don't have access to any Settings section" — and, in the other
      // direction, a REVOKING override left the tab visible.
      //
      // Same shape and same reason as `access` above, which the Nav already
      // consumes: the server decides, the client renders. Built from
      // SETTINGS_TABS so a new tab cannot be forgotten here.
      settingsTabs: Object.fromEntries(
        SETTINGS_TABS.map((t) => [t, canAccessSettingsTab(user, t)]),
      ) as Record<SettingsTab, boolean>,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
