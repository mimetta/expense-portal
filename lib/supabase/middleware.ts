import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedDomain } from "@/lib/domain";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/auth-error"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the auth token if needed. Per-page role access (BO/CEO/
  // procurement/accounting scoping) is enforced in each page/API route via
  // lib/permissions.ts — this only handles "is there a valid, in-domain
  // session at all".
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /api/cron/* is invoked directly by Vercel Cron (no user session) — those
  // routes authenticate via a CRON_SECRET bearer token themselves instead.
  const isPublicPath =
    PUBLIC_PATHS.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/api/cron");

  if (!isPublicPath && (!user || !isAllowedDomain(user.email))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
