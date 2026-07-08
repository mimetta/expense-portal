import Link from "next/link";
import { NEW_EMAIL_DOMAIN } from "@/lib/constants";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  const message =
    reason === "domain"
      ? `Only @${NEW_EMAIL_DOMAIN} Google Workspace accounts can sign in to this portal.`
      : "Something went wrong while signing you in. Please try again.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-cream">
      <div className="w-full max-w-sm rounded-lg border border-brand-border bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-brand-dark">Sign-in failed</h1>
        <p className="mb-6 text-sm text-brand-dark/70">{message}</p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-brand-brown px-4 py-2 font-medium text-white transition hover:bg-brand-accent"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
