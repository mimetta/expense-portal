import { boScopeMatchesRequest } from "@/lib/scope-match";
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

/**
 * The roles a person can be GRANTED. EMPLOYEE is deliberately absent: it is
 * implicit for every active person (see hasRoleV2), so offering it as a
 * checkbox would be offering to turn off something that cannot be turned
 * off. The person card renders exactly this list.
 */
export const ASSIGNABLE_ROLES: RoleV2[] = [
  "SUPERADMIN", "CEO", "ACCOUNTING", "BO", "PROCUREMENT", "PETTY_CASH_CUSTODIAN",
];

export interface PersonV2 {
  email: string;
  bu: "ONEST" | "SV" | "BOTH";
  bu_defaulted: boolean;
  visible_departments: string;
  chapter: string | null;
  active: boolean;
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
 * These are the mockup's defaults verbatim. Stage 2a set several of them
 * narrower than reality and absorbed the difference into per-person
 * overrides — which was wrong: when every ACCOUNTING holder carries the same
 * two exceptions, the default is wrong, not the people. Corrected here, and
 * the three menus the mockup originally omitted (signature rules,
 * announcements, petty cash custodians) are now part of the approved design.
 */
export const FREE_MENU_DEFAULTS: Record<string, RoleV2[]> = {
  "spend-report": ["EMPLOYEE", "BO", "CEO", "ACCOUNTING", "PROCUREMENT", "PETTY_CASH_CUSTODIAN"],
  budget: ["BO", "CEO", "ACCOUNTING"],
  // Nobody: SUPERADMIN only, via the unconditional grant in menuDefault.
  "settings.categories": [],
  "settings.products": ["PROCUREMENT"],
  "settings.suppliers": ["PROCUREMENT", "ACCOUNTING"],
  "settings.companies": ["ACCOUNTING"],
  "settings.deptconfig": ["CEO"],
  "settings.announcements": ["CEO", "ACCOUNTING"],
  "settings.pettycash": ["ACCOUNTING"],
  // Stage 2c: the three keys (users / people / permissions) that always moved
  // together are now one menu, matching the single page that replaced them.
  "settings.usersaccess": [],
};

export const ALL_MENUS = [
  ...Object.keys(WORKFLOW_MENUS),
  ...Object.keys(FREE_MENU_DEFAULTS),
];

/**
 * EMPLOYEE IS IMPLICIT. Every active person is one; it is not a checkbox and
 * no longer a person_roles row (migration 037 removed them).
 *
 * The single place that is expressed. Because hasRoleV2 answers true for it,
 * FREE_MENU_DEFAULTS, menuDefault and canAccessPageV2 keep working verbatim —
 * an "EMPLOYEE" entry in a defaults list now reads as "everyone", which is
 * exactly what it already meant in practice: EMPLOYEE granted spend-report
 * and nothing else, and every other role already carried spend-report too.
 *
 * Gated on `active` so a deactivated person inherits nothing. They cannot
 * sign in (lib/auth.ts and the middleware both refuse them), so this is
 * belt-and-braces rather than the enforcement point.
 */
export const hasRoleV2 = (p: PersonV2, r: RoleV2) =>
  r === "EMPLOYEE" ? p.active : p.roles.includes(r);

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
      // DELIBERATE CHANGE from the old rule ("any role that is not
      // EMPLOYEE"), which let a BO-only person open Settings and find no
      // tabs at all. Access now means holding at least one settings menu, so
      // that empty page goes away. This is the one intended parity
      // difference in stage 2b.
      return Object.keys(FREE_MENU_DEFAULTS)
        .filter((m) => m.startsWith("settings."))
        .some((m) => canOpenMenu(p, m));
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
