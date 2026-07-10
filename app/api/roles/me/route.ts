import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage, type Page } from "@/lib/permissions";

const PAGES: Page[] = [
  "submit",
  "my",
  "procurement",
  "bo-approvals",
  "ceo-approvals",
  "accounting",
  "dashboard",
  "settings",
];

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
