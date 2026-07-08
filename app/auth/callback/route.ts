import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedDomain } from "@/lib/domain";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // The Google `hd` param only narrows the account picker — a user can
      // still complete OAuth with a non-workspace Google account, so the
      // domain must be re-checked server-side before granting a session.
      if (!isAllowedDomain(data.user?.email)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/auth/auth-error?reason=domain`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-error`);
}
