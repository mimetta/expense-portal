"use client";

import { createClient } from "@/lib/supabase/client";
import { NEW_EMAIL_DOMAIN } from "@/lib/constants";

function DeactivatedNotice() {
  // Set by lib/supabase/middleware.ts. Without it a deactivated person is
  // bounced to /login with no explanation and will simply try again.
  if (typeof window === "undefined") return null;
  if (new URLSearchParams(window.location.search).get("reason") !== "deactivated") return null;
  return (
    <div className="mb-3 rounded-[10px] px-4 py-3 text-[13px]"
      style={{ background: "#FBF0EE", border: "1px solid #F3C4BC", color: "#B23A2F" }}>
      This account has been deactivated in the expense portal. Contact an admin if you think
      that is a mistake.
    </div>
  );
}

export default function LoginPage() {
  const handleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Narrows the Google account chooser to the workspace domain. This
        // is a UX hint only — the callback route re-verifies the domain
        // server-side before creating a session.
        queryParams: { hd: NEW_EMAIL_DOMAIN },
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-cream">
      <div className="w-full max-w-sm rounded-lg border border-brand-border bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-brand-dark">Mimetta</h1>
        <p className="mb-6 text-sm text-brand-muted">Expense Portal</p>
        <DeactivatedNotice />
        <button
          onClick={handleSignIn}
          className="w-full rounded-md bg-brand-brown px-4 py-2 font-medium text-white transition hover:bg-brand-accent"
        >
          Sign in with Google
        </button>
        <p className="mt-4 text-xs text-brand-subtle">
          @{NEW_EMAIL_DOMAIN} accounts only
        </p>
      </div>
    </div>
  );
}
