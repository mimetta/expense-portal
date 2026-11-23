import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // The kit's icons must load without a session (brand/CHECKLIST.md), so
  // favicon.ico / icon.svg / apple-icon.png are excluded here. The trailing
  // image-extension rule already covered them; they are named explicitly so
  // narrowing that rule later cannot quietly put the icons behind sign-in.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
