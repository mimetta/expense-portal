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

  // Two route families carry no user session and authenticate themselves:
  //
  //   /api/cron/*        — invoked by Vercel Cron, checks a CRON_SECRET bearer.
  //   /api/external/v1/* — the outbound read-only API, checks the x-api-key
  //                        header (lib/external-api.ts).
  //
  // Without this exemption the session check below 307s them to /login, and a
  // machine caller gets an HTML redirect instead of its JSON — which is
  // exactly what happened on the first deploy of the external API. Exempting
  // them does NOT make them public: each refuses on its own credential, and
  // the external one fails closed when its env var is unset.
  const isPublicPath =
    PUBLIC_PATHS.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    // Vercel Cron calls this one too, and it does not live under /api/cron
    // because the budget page's "Sync now" and status poll share it. Its own
    // handler requires either the cron secret or a CEO/SUPERADMIN session, so
    // exempting it here changes who may run it not at all — it only stops a
    // machine caller receiving an HTML redirect instead of JSON.
    request.nextUrl.pathname === "/api/revenue-sync" ||
    request.nextUrl.pathname.startsWith("/api/external/");

  if (!isPublicPath && (!user || !isAllowedDomain(user.email))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // DEACTIVATION. lib/auth.ts#getCurrentUser also refuses a deactivated
  // person, which makes every API route 401 — but this middleware never
  // calls it, so without this check they still reach page shells instead of
  // being bounced to /login. "Cannot sign in" has to be enforced where
  // sign-in is actually gated, which is here.
  //
  // A direct REST fetch rather than lib/supabase/admin.ts: this file runs in
  // the Edge runtime, and it is deliberately dependency-free (see the note on
  // isAllowedDomain above). Fails OPEN on a network/config error — the API
  // layer still refuses them, so a transient failure here degrades to "can
  // load an empty shell", not "everyone is locked out".
  if (!isPublicPath && user?.email) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      try {
        const res = await fetch(
          `${url}/rest/v1/people?select=active&email=eq.${encodeURIComponent(user.email)}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
        );
        if (res.ok) {
          const rows = (await res.json()) as { active?: boolean }[];
          if (rows.length > 0 && rows[0].active === false) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("reason", "deactivated");
            return NextResponse.redirect(loginUrl);
          }
        }
      } catch {
        // Fail open — see above.
      }
    }
  }

  return response;
}
