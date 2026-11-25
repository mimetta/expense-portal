"use client";

import Link from "next/link";
import { NAV_GROUPS, type NavItem } from "./navConfig";
import { NAV_ICONS } from "./navIcons";
import type { Page } from "@/lib/permissions";

/**
 * The grouped link list. One component, used by both the desktop rail and
 * the mobile drawer, so the two can never drift.
 *
 * ===========================================================================
 * `access` IS THE WHOLE VISIBILITY RULE, AND IT COMES FROM THE SERVER.
 * ===========================================================================
 * `access` is GET /api/roles/me's map, built by iterating PAGES through
 * lib/permissions.ts#canAccessPage — the same object, read with the same
 * test (`access[page]`), that the old top nav filtered on. Nothing about
 * who-sees-what is computed in this file.
 */
export default function SidebarNav({
  access,
  badges,
  pathname,
  collapsed,
  onNavigate,
}: {
  access: Partial<Record<Page, boolean>> | undefined;
  badges: Partial<Record<Page, number>> | undefined;
  pathname: string;
  collapsed: boolean;
  /** Called on any link click — the drawer uses it to close itself. */
  onNavigate?: () => void;
}) {
  // Identical test to the old nav's `LINKS.filter((l) => data.access?.[l.page])`.
  // An item with no `page` is ungated (Home — see navConfig.tsx).
  const visible = (item: NavItem) => item.page === undefined || Boolean(access?.[item.page]);

  // Same rule the old nav used: `pathname.startsWith(href)`. "/" would match
  // everything under startsWith, so it is compared exactly.
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const ring =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kf-palette-lime)]";

  return (
    <nav
      aria-label="Main"
      className={`flex-1 overflow-y-auto pb-2 pt-3 ${collapsed ? "px-1.5" : "px-2.5"}`}
    >
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(visible);
        if (items.length === 0) return null;

        return (
          <div key={group.heading}>
            {collapsed ? (
              // Collapsed: the heading becomes a hairline. aria-hidden, since
              // a divider is not a name — the items keep their own.
              <div
                aria-hidden
                className="mx-2 my-3 h-px"
                style={{
                  background: "color-mix(in srgb, var(--kf-text-on-brand) 13%, transparent)",
                }}
              />
            ) : (
              <p
                className="px-2.5 pb-1.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.11em]"
                style={{ color: "var(--kf-palette-on-green-faint)" }}
              >
                {group.heading}
              </p>
            )}

            {items.map((item) => {
              const active = isActive(item.href);
              const count = item.page ? badges?.[item.page] ?? 0 : 0;
              // Collapsed, the label is gone from the page, so the count has
              // to be spoken as part of the accessible name or it is lost.
              const accessibleName =
                count > 0 ? `${item.label} — ${count} waiting` : item.label;

              return (
                <div key={item.href} className="relative">
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-[3px]"
                      style={{ background: "var(--kf-palette-lime)" }}
                    />
                  )}
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? accessibleName : undefined}
                    title={collapsed ? accessibleName : undefined}
                    className={`relative mb-px flex items-center gap-2.5 rounded-md text-[12.5px] font-medium no-underline transition-colors hover:bg-kf-palette-deep-green-hover hover:text-kf-text-on-brand ${ring} ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2"
                    } ${active ? "text-kf-text-on-brand" : ""}`}
                    style={{
                      color: active ? undefined : "var(--kf-palette-on-green-muted)",
                      background: active ? "var(--kf-palette-deep-green-hover)" : undefined,
                    }}
                  >
                    <span className="shrink-0">{NAV_ICONS[item.icon]}</span>
                    {!collapsed && <span className="overflow-hidden whitespace-nowrap">{item.label}</span>}

                    {count > 0 &&
                      (collapsed ? (
                        // Collapsed: a lime dot. The number lives in the
                        // accessible name above.
                        <span
                          aria-hidden
                          className="absolute right-1.5 top-[3px] h-[7px] w-[7px] rounded-full"
                          style={{ background: "var(--kf-palette-lime)" }}
                        />
                      ) : (
                        <span
                          className="ml-auto rounded-[9px] px-1.5 text-[10px] font-bold leading-[1.5]"
                          style={{
                            background: "var(--kf-palette-lime)",
                            color: "var(--kf-palette-deep-green)",
                          }}
                        >
                          {count > 99 ? "99+" : count}
                        </span>
                      ))}
                  </Link>

                  {/* The badge's own destination, when it differs from the
                      label's. Kept as a SEPARATE link rather than nesting
                      one <a> inside another, which is invalid HTML and
                      would not reliably receive the click — the same
                      reasoning, and the same budget-history target, as the
                      old top nav. Hidden when collapsed: a 7px dot is too
                      small to be its own click target. */}
                  {count > 0 && item.badgeHref && !collapsed && (
                    <Link
                      href={item.badgeHref}
                      onClick={onNavigate}
                      title={`${count} budget revision${count === 1 ? "" : "s"} waiting for your approval — open the queue`}
                      className={`absolute inset-y-0 right-0 w-11 rounded-md ${ring}`}
                      aria-label={`${count} budget revision${count === 1 ? "" : "s"} waiting for your approval — open the queue`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
