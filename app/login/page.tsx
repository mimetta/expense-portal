"use client";

import { createClient } from "@/lib/supabase/client";
import { NEW_EMAIL_DOMAIN } from "@/lib/constants";

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
        // Grants this app's own OAuth access token (session.provider_token)
        // permission to create/write files in Drive — required for the
        // /submit attachments-to-Drive upload (see lib/google-drive.ts,
        // app/api/upload-to-drive/route.ts). Anyone who signed in before
        // this scope was added keeps their existing, Drive-less token until
        // they sign out and back in once — see that route's header comment.
        scopes: "https://www.googleapis.com/auth/drive.file",
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-cream">
      <div className="w-full max-w-sm rounded-lg border border-brand-border bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-brand-dark">Mimetta</h1>
        <p className="mb-6 text-sm text-brand-muted">Expense Portal</p>
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
