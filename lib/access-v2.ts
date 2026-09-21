import { boScopeMatchesRequest } from "@/lib/permissions";
import type { ExpenseRequest, RoleRow } from "@/types/database";

// Users & access rebuild, stage 2a — the NEW permission logic.
//
// ============================================================================
// NOT WIRED INTO THE APP. Nothing imports this except the parity check.
// ============================================================================
// Every permission decision in the running app still goes through
// lib/permissions.ts against the `roles` table. These are pure functions over
// the new tables, written so their output can be diffed cell-by-cell against
// docs/access-baseline.md before anything switches.

export type RoleV2 =
  | "SUPERADMIN" | "CEO" | "ACCOUNTING" | "BO"
  | "PROCUREMENT" | "PETTY_CASH_CUSTODIAN" | "EMPLOYEE";

export interface PersonV2 {
  email: string;
  bu: "ONEST" | "SV" | "BOTH";
  bu_defaulted: boolean;
  visible_departments: string;
  roles: RoleV2[];
  boScopes: { bu_scope: string; dept_scope: string; cat_l1_scope: string }[];
  overrides: Record<string, boolean>;
}

/**
 * Menus that DO something. Locked to the role: granting one without the role
 * shows a page the person cannot act on. These never accept an override.
 */
export const WORKFLOW_MENUS: Record<string, RoleV2> = {
  "bo-approvals": "BO",
  "ceo-approvals": "CEO",
  accounting: "ACCOUNTING",
  procurement: "PROCUREMENT",
  "petty-cash": "PETTY_CASH_CUSTODIAN",
};

/**
 * Viewing and settings menus: default from roles, overridable per person.
 *
 * The first two blocks are the mockup's own defaults. The last three
 * (deptconfig, announcements, pettycash) are NOT in the mockup — it lists
 * seven menus while the app has ten settings surfaces. Omitting them would
 * remove CEO's signature rules and announcements, and Accounting's
 * announcements and custodians, with no way for an override to restore a menu
 * that does not exist. Their defaults below are today's live
 * settings_tab_permissions role sets, so parity holds without inventing a
 * per-person exception for something that is really a missing menu.
 * FLAGGED FOR THE DESIGN — see the stage 2a report.
 */
export const FREE_MENU_DEFAULTS: Record<string, RoleV2[]> = {
  "spend-report": ["EMPLOYEE", "BO", "CEO", "ACCOUNTING"],
  budget: ["BO", "CEO", "ACCOUNTING"],
  "settings.categories": ["ACCOUNTING"],
  "settings.products": ["PROCUREMENT"],
  "settings.suppliers": ["PROCUREMENT"],
  "settings.companies": ["ACCOUNTING"],
  // Merged in the mockup as one "Users & access" control; kept as three keys
  // here so each maps 1:1 to a baseline column. All three are SUPERADMIN-only,
  // so they always move together.
  "settings.users": [],
  "settings.people": [],
  "settings.permissions": [],
  // Not in the mockup — see above.
  "settings.deptconfig": ["CEO"],
  "settings.announcements": ["CEO", "ACCOUNTING"],
  "settings.pettycash": ["ACCOUNTING"],
};

export const ALL_MENUS = [
  ...Object.keys(WORKFLOW_MENUS),
  ...Object.keys(FREE_MENU_DEFAULTS),
];

export const hasRoleV2 = (p: PersonV2, r: RoleV2) => p.roles.includes(r);
export const isSuperadminV2 = (p: PersonV2) => p.roles.includes("SUPERADMIN");

/** What the roles alone would give, before any override. */
export function menuDefault(p: PersonV2, menu: string): boolean {
  if (isSuperadminV2(p)) return true;
  const wf = WORKFLOW_MENUS[menu];
  if (wf) return hasRoleV2(p, wf);
  const roles = FREE_MENU_DEFAULTS[menu];
  if (!roles) return false;
  return roles.some((r) => hasRoleV2(p, r));
}

/** The effective answer: default, unless an override says otherwise. */
export function canOpenMenu(p: PersonV2, menu: string): boolean {
  if (isSuperadminV2(p)) return true;
  // Workflow menus ignore overrides by construction.
  if (WORKFLOW_MENUS[menu]) return menuDefault(p, menu);
  const o = p.overrides[menu];
  return o === undefined ? menuDefault(p, menu) : o;
}

/**
 * Page access. Submit and My Requests are unconditional for everyone.
 * `dashboard` still redirects to `/`; `settings` is the container.
 */
export function canAccessPageV2(p: PersonV2, page: string): boolean {
  if (isSuperadminV2(p)) return true;
  switch (page) {
    case "submit":
    case "my":
      return true;
    case "dashboard":
      return hasRoleV2(p, "CEO") || hasRoleV2(p, "ACCOUNTING");
    case "settings":
      // Today: any role other than a pure EMPLOYEE, which is why a BO-only
      // person reaches Settings and then matches no tab. Preserved verbatim
      // rather than re-derived from menus, which would drop that case.
      return p.roles.some((r) => r !== "EMPLOYEE");
    case "bo-approvals":
    case "ceo-approvals":
    case "accounting":
    case "procurement":
    case "petty-cash":
    case "spend-report":
    case "budget":
      return canOpenMenu(p, page);
    default:
      return false;
  }
}

export const canAccessSettingsTabV2 = (p: PersonV2, tab: string) =>
  canOpenMenu(p, `settings.${tab}`);

// --- actions ---------------------------------------------------------------

/**
 * BO approval scope. Reuses boScopeMatchesRequest UNCHANGED — bo_scopes rows
 * carry the same three columns in the same convention, so they are passed
 * straight through the existing matcher rather than a second copy of the
 * comma/wildcard rules.
 */
export function canBoActOnRequestV2(p: PersonV2, request: ExpenseRequest): boolean {
  if (isSuperadminV2(p)) return true;
  if (!hasRoleV2(p, "BO")) return false;
  return p.boScopes.some((s) =>
    boScopeMatchesRequest(s as unknown as RoleRow, request),
  );
}

export function canPettyCashActOnRequestV2(p: PersonV2, request: ExpenseRequest): boolean {
  if (isSuperadminV2(p)) return true;
  return hasRoleV2(p, "PETTY_CASH_CUSTODIAN") && request.petty_cash_holder_email === p.email;
}

export function canViewRequestV2(p: PersonV2, request: ExpenseRequest): boolean {
  if (isSuperadminV2(p)) return true;
  if (request.requester_email === p.email) return true;
  if (hasRoleV2(p, "CEO") || hasRoleV2(p, "ACCOUNTING") || hasRoleV2(p, "PROCUREMENT")) return true;
  if (hasRoleV2(p, "BO")) return canBoActOnRequestV2(p, request);
  if (hasRoleV2(p, "PETTY_CASH_CUSTODIAN")) return canPettyCashActOnRequestV2(p, request);
  return false;
}

export const canManageProductsV2 = (p: PersonV2) => canOpenMenu(p, "settings.products");
export const canEditRevenueGoalsV2 = (p: PersonV2) =>
  isSuperadminV2(p) || hasRoleV2(p, "CEO");

/** Spend-report scope: the same three-way split, sourced from the new tables. */
export function spendScopeV2(p: PersonV2): "all" | "none" | { departments: string[] } | "bo" {
  if (isSuperadminV2(p) || hasRoleV2(p, "CEO") || hasRoleV2(p, "ACCOUNTING")) return "all";
  if (hasRoleV2(p, "BO")) return "bo";
  const departments = p.visible_departments.split(",").map((s) => s.trim()).filter((s) => s && s !== "*");
  return departments.length ? { departments } : "none";
}

/**
 * The BU stamped on this person's requests. In v2 it is simply the person's
 * own field — no scanning of role rows, and no order-dependence.
 */
export const submitBuV2 = (p: PersonV2) => p.bu;
