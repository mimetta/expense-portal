import { NEW_EMAIL_DOMAIN } from "@/lib/constants";

// Kept dependency-free (no supabase client imports) so it's safe to use from
// the Edge middleware runtime as well as server/API code.
export function isAllowedDomain(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${NEW_EMAIL_DOMAIN}`);
}
