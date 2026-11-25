import type { Page } from "@/lib/permissions";

/**
 * The sidebar's destinations, grouped.
 *
 * DATA ONLY, AND NO JSX ON PURPOSE. The icons live in navIcons.tsx and
 * are looked up by `icon` key. Keeping this file plain TypeScript is what
 * lets scripts/verify-nav-parity.ts import the real menu structure and
 * diff it against the old nav's — a .tsx file cannot be required from a
 * plain Node script, and a transcribed copy of the list would prove
 * nothing about the list the app actually renders.
 *
 * ===========================================================================
 * VISIBILITY IS NOT DECIDED HERE AND MUST NOT BE.
 * ===========================================================================
 * Every item carries the same `page` key the old top nav used, and the
 * sidebar filters on `access[page]` from GET /api/roles/me — the identical
 * test, against the identical map, that components/Nav.tsx applied. This
 * file changes how the links are grouped and drawn and nothing else. Do not
 * add a role check, a scope check or a department check to an item here:
 * the answer already exists, server-side, in lib/permissions.ts#canAccessPage.
 *
 * The one item with no `page` is Home. `/` has no entry in the Page union
 * and no access gate — app/page.tsx only redirects a visitor with no
 * session — so it is reachable by anyone who can see the sidebar at all.
 * It was already reachable by clicking the lockup; it is simply listed now.
 */

export type NavIconKey =
  | "home" | "submit" | "my" | "check" | "star"
  | "accounting" | "procurement" | "pettyCash"
  | "budget" | "spend" | "branch" | "settings";

export interface NavItem {
  /** Access key in GET /api/roles/me's `access` map. Absent = ungated. */
  page?: Page;
  href: string;
  label: string;
  icon: NavIconKey;
  /**
   * Where the COUNT goes, when it differs from where the label goes.
   * Budget's badge counts revisions awaiting approval, which live on
   * /budget/history — sending it to /budget (the editor) would show a
   * number and then hide what it counts.
   */
  badgeHref?: string;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Requests",
    items: [
      { href: "/", label: "Home", icon: "home" },
      { page: "submit", href: "/submit", label: "Submit", icon: "submit" },
      { page: "my", href: "/my", label: "My requests", icon: "my" },
    ],
  },
  {
    heading: "Approvals",
    items: [
      { page: "bo-approvals", href: "/bo-approvals", label: "BO approvals", icon: "check" },
      { page: "ceo-approvals", href: "/ceo-approvals", label: "CEO approvals", icon: "star" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { page: "accounting", href: "/accounting", label: "Accounting", icon: "accounting" },
      { page: "procurement", href: "/procurement", label: "Procurement", icon: "procurement" },
      { page: "petty-cash", href: "/petty-cash", label: "Petty cash", icon: "pettyCash" },
    ],
  },
  {
    heading: "Planning",
    items: [
      {
        page: "budget",
        href: "/budget",
        label: "Budget",
        icon: "budget",
        badgeHref: "/budget/history?tab=pending",
      },
      { page: "spend-report", href: "/reports/spend", label: "Spend report", icon: "spend" },
      { page: "branch-review", href: "/reports/branch-review", label: "Branch review", icon: "branch" },
    ],
  },
  {
    heading: "System",
    items: [{ page: "settings", href: "/settings", label: "Settings", icon: "settings" }],
  },
];

/**
 * Pages that open collapsed by default — they are wide tables and the
 * sidebar costs them 184px. An explicit choice by the person overrides this
 * everywhere (see AppShell).
 */
export const COLLAPSE_BY_DEFAULT = ["/reports/spend", "/budget"];

/** localStorage key for the person's explicit collapse choice. */
export const COLLAPSE_KEY = "kf.sidebar.collapsed";
