import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
// PAGES is exported from lib/permissions.ts and derived from an exhaustive
// Record<Page, true>, so it can never again drift out of sync with the Page
// union — a page missing here is invisible in the nav with no error at all.
import { canAccessPage, PAGES } from "@/lib/permissions";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const access = Object.fromEntries(PAGES.map((p) => [p, canAccessPage(user, p)]));

    return NextResponse.json({
      user: { email: user.email, name: user.name, allRoles: user.allRoles, chapter: user.chapter },
      access,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
