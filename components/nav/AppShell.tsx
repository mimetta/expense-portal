"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NotificationBell from "@/components/NotificationBell";
import ModuleSwitcher from "./ModuleSwitcher";
import SidebarNav from "./SidebarNav";
import SidebarFooter from "./SidebarFooter";
import { COLLAPSE_BY_DEFAULT, COLLAPSE_KEY } from "./navConfig";
import type { Page } from "@/lib/permissions";
import type { RoleRow } from "@/types/database";

/**
 * The app shell: left sidebar, page header with the bell, and the page.
 * Replaces the top bar, which wrapped once there were more than a handful
 * of links and had nowhere to go on a phone.
 * Design of record: docs/sidebar-nav-mockup.html.
 *
 * ===========================================================================
 * VISIBILITY IS UNCHANGED, DELIBERATELY.
 * ===========================================================================
 * This component fetches GET /api/roles/me and hands `access` and `badges`
 * straight to SidebarNav, which filters with `access[page]` — byte for byte
 * the rule components/Nav.tsx applied. No role, scope or department test was
 * rewritten, simplified or moved into the client. The badge count still
 * comes from the same `badges.budget` field of the same response.
 */

interface RoleMeResponse {
  user: { email: string; name: string; allRoles?: RoleRow[] } | null;
  access?: Record<Page, boolean>;
  badges?: Partial<Record<Page, number>>;
}

/** Display label for the person's role, for the sidebar foot. */
function roleLabel(allRoles: RoleRow[] | undefined): string {
  const roles = Array.from(new Set((allRoles ?? []).map((r) => r.role).filter(Boolean)));
  if (roles.includes("SUPERADMIN")) return "Superadmin";
  if (roles.length === 0) return "Employee";
  const pretty = (r: string) =>
    r
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" ");
  return roles.length <= 2 ? roles.map(pretty).join(" · ") : `${pretty(roles[0])} +${roles.length - 1}`;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<RoleMeResponse | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // null = the person has never chosen, so the per-page default applies.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData({ user: null }));
  }, []);

  // Read the stored choice once. Wrapped because a blocked or disabled store
  // throws on access in some browsers (Safari private mode, a locked-down
  // profile) — the sidebar must render expanded, not crash the whole app.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1" || raw === "0") setChoice(raw === "1");
    } catch {
      /* no stored preference available — fall through to the page default */
    }
  }, []);

  const pageDefaultCollapsed = COLLAPSE_BY_DEFAULT.some((p) => pathname.startsWith(p));
  // An explicit choice wins on every page; otherwise the wide-table pages
  // open collapsed and everything else expanded.
  const collapsed = choice ?? pageDefaultCollapsed;

  const toggleCollapse = useCallback(() => {
    const next = !collapsed;
    setChoice(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* preference just will not persist; the session still honours it */
    }
  }, [collapsed]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    burgerRef.current?.focus();
  }, []);

  // Escape closes the drawer, and the page behind it does not scroll.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen, closeDrawer]);

  // Focus moves into the drawer when it opens.
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.focus();
  }, [drawerOpen]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const bare = pathname.startsWith("/login") || pathname.startsWith("/auth");
  // `w-full` is load-bearing. <main> used to be a block child of <body>;
  // it is now a flex item, and `mx-auto` on a flex item disables the
  // default stretch and sizes it to its CONTENT — which measured 1280px
  // inside a 1200px column and pushed the whole document 80px wide, with a
  // horizontal scrollbar on every page. `w-full` restores "fill the column,
  // then cap at 1280".
  const main = (
    <main className="mx-auto w-full max-w-[1280px] px-8 pb-6 pt-2">{children}</main>
  );

  // Sign-in pages carry no chrome, and neither does a session-less or
  // failed response — exactly when the old Nav returned null. The wrapper
  // around `children` is unchanged from before so those pages look the same.
  if (bare || (data !== null && !data.user)) {
    return <main className="mx-auto w-full max-w-[1280px] px-8 py-6">{children}</main>;
  }

  const user = data?.user;
  const needsRoleAssignment = user?.allRoles?.some((r) => r.is_auto_registered) ?? false;

  const sidebarInner = (inDrawer: boolean) => (
    <>
      <ModuleSwitcher collapsed={collapsed && !inDrawer} />
      <SidebarNav
        access={data?.access}
        badges={data?.badges}
        pathname={pathname}
        collapsed={collapsed && !inDrawer}
        onNavigate={inDrawer ? closeDrawer : undefined}
      />
      {user && (
        <SidebarFooter
          name={user.name}
          email={user.email}
          role={roleLabel(user.allRoles)}
          collapsed={collapsed && !inDrawer}
          onToggleCollapse={inDrawer ? undefined : toggleCollapse}
          showCollapseToggle={!inDrawer}
          onSignOut={handleSignOut}
        />
      )}
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop rail. Hidden below md, where the drawer takes over. */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-kf-bg-brand text-kf-text-on-brand transition-[width] duration-150 md:flex print:hidden ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        {sidebarInner(false)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar, 52px. */}
        <div className="flex h-[52px] shrink-0 items-center gap-3 bg-kf-bg-brand px-3.5 text-kf-text-on-brand md:hidden print:hidden">
          <button
            ref={burgerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="flex rounded-md p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kf-palette-lime)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className="flex min-w-0 flex-col leading-[1.15]">
            <span
              className="text-[10px] font-medium lowercase tracking-[0.14em]"
              style={{ color: "var(--kf-palette-on-green-faint)" }}
            >
              kindfolks
            </span>
            <span className="truncate text-[13px] font-semibold">Expenses</span>
          </span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>

        {/* Desktop page header: the bell, top right. */}
        <div className="hidden h-12 shrink-0 items-center justify-end px-8 md:flex print:hidden">
          <NotificationBell />
        </div>

        {needsRoleAssignment && !bannerDismissed && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium"
            style={{
              background: "var(--kf-palette-brown-tint)",
              borderBottom: "1px solid var(--kf-status-at-risk)",
              color: "var(--kf-status-at-risk-strong)",
            }}
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

        {main}
      </div>

      {/* Mobile drawer: the same sidebar, over the page. */}
      {drawerOpen && (
        <div className="md:hidden print:hidden">
          <div
            className="fixed inset-0 z-40 bg-kf-palette-ink/40"
            onClick={closeDrawer}
            aria-hidden
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 flex w-[262px] flex-col bg-kf-bg-brand text-kf-text-on-brand shadow-lg focus:outline-none"
          >
            {sidebarInner(true)}
          </div>
        </div>
      )}
    </div>
  );
}
