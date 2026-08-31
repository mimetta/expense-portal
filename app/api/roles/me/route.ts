import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
// PAGES is exported from lib/permissions.ts and derived from an exhaustive
// Record<Page, true>, so it can never again drift out of sync with the Page
// union — a page missing here is invisible in the nav with no error at all.
import { canAccessPage, PAGES } from "@/lib/permissions";
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
      user: { email: user.email, name: user.name, allRoles: user.allRoles, chapter: user.chapter },
      access,
      badges,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
