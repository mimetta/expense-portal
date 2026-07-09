"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Page } from "@/lib/permissions";
import type { RoleRow } from "@/types/database";

interface RoleMeResponse {
  user: { email: string; name: string; allRoles?: RoleRow[] } | null;
  access?: Record<Page, boolean>;
}

// "dashboard" deliberately omitted — the homepage (/) now serves as the
// dashboard; the /dashboard route itself still exists (redirects to /) in
// case anything still links there directly. See CLAUDE.md "Homepage".
const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "submit", href: "/submit", label: "Submit" },
  { page: "my", href: "/my", label: "My Requests" },
  { page: "procurement", href: "/procurement", label: "Procurement" },
  { page: "bo-approvals", href: "/bo-approvals", label: "BO Approvals" },
  { page: "ceo-approvals", href: "/ceo-approvals", label: "CEO Approvals" },
  { page: "accounting", href: "/accounting", label: "Accounting" },
  { page: "settings", href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<RoleMeResponse | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData({ user: null }));
  }, []);

  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;
  if (!data?.user) return null;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  // True for a user whose only roles row(s) are the ones lib/auth.ts#
  // getCurrentUser auto-created on their first sign-in — i.e. nobody has
  // manually assigned them anything yet. Clears itself once an admin edits
  // their role via Settings > User Management (PATCH /api/roles/[id]
  // always resets is_auto_registered to false on save).
  const needsRoleAssignment = data.user.allRoles?.some((r) => r.is_auto_registered) ?? false;

  return (
    <>
      <nav className="h-12 border-b border-brand-border bg-white">
        <div className="mx-auto flex h-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-6">
          <div className="flex h-full items-center gap-1">
            <Link href="/" className="mr-4 text-sm font-semibold text-brand-brown">
              Mimetta
            </Link>
            {LINKS.filter((link) => data.access?.[link.page]).map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex h-full items-center border-b-2 px-3 text-sm transition ${
                    active
                      ? "border-brand-brown font-medium text-brand-brown"
                      : "border-transparent font-normal text-gray-500 hover:text-brand-dark"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{data.user.email}</span>
            <button
              onClick={handleSignOut}
              className="rounded-md border border-brand-border px-3 py-1 text-sm text-brand-dark hover:bg-brand-cream"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>
      {needsRoleAssignment && !bannerDismissed && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium"
          style={{ background: "#FEF3C7", borderBottom: "1px solid #F59E0B", color: "#92400E" }}
        >
          <span className="mx-auto max-w-6xl flex-1">
            ⚠️ บัญชีของคุณยังไม่ได้รับการกำหนดสิทธิ์ กรุณาติดต่อ Admin เพื่อขอสิทธิ์การใช้งาน
          </span>
          <button
            onClick={() => setBannerDismissed(true)}
            className="mr-2 text-base leading-none hover:opacity-70"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
