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
      style={{ background: "var(--kf-palette-terracotta-tint)", border: "1px solid var(--kf-palette-terracotta)", color: "var(--kf-status-late)" }}>
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
    <div className="flex min-h-screen items-center justify-center bg-kf-bg-page">
      <div className="w-full max-w-sm rounded-lg border border-kf-border bg-kf-bg-surface p-8 text-center shadow-sm">
        {/* The lockup, stacked: Nav is hidden on /login, so the sign-in
            card carries it (brand/wordmark/README.md). */}
        <div className="mb-6 flex items-center justify-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/kindfolks-on-light.svg"
            alt="Kindfolks"
            className="h-[23px] w-auto"
          />
          <span className="mx-1 text-kf-text-hint" aria-hidden="true">
            /
          </span>
          <span className="text-[14px] text-kf-text-muted">Expenses</span>
        </div>
        <DeactivatedNotice />
        <button
          onClick={handleSignIn}
          className="w-full rounded-md bg-kf-bg-brand px-4 py-2 font-medium text-kf-text-on-brand transition hover:bg-kf-palette-deep-green-hover"
        >
          Sign in with Google
        </button>
        <p className="mt-4 text-xs text-kf-text-hint">
          @{NEW_EMAIL_DOMAIN} accounts only
        </p>
      </div>
    </div>
  );
}
