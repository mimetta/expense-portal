import type { CurrentUser, DeptConfigRow, ExpenseRequest, RejectionHistoryEntry, RoleRow } from "@/types/database";
import type { Role } from "@/lib/constants";

// --- role helpers ------------------------------------------------------
// Always check against the full all_roles array. A user's "primary" role is
// not a concept in this system — multiple roles rows per email are normal.

export function hasRole(user: CurrentUser, role: Role): boolean {
  return user.allRoles.some((r) => r.role === role);
}

export function hasAnyRole(user: CurrentUser, roles: Role[]): boolean {
  return roles.some((role) => hasRole(user, role));
}

export function isSuperadmin(user: CurrentUser): boolean {
  return hasRole(user, "SUPERADMIN");
}

export function rolesOf(user: CurrentUser, role: Role): RoleRow[] {
  return user.allRoles.filter((r) => r.role === role);
}

export type Page =
  | "submit"
  | "my"
  | "procurement"
  | "bo-approvals"
  | "ceo-approvals"
  | "accounting"
  | "dashboard"
  | "settings";

// Every @mimetta.co user gets Submit + My Requests (they are, at minimum, an
// employee who can incur expenses). Additional pages require the matching
// role, and SUPERADMIN always has full access. Dashboard (budget/financial
// visibility) is granted to SUPERADMIN, CEO, and ACCOUNTING — this isn't
// spelled out per-role in the requirements, but it's the natural reading of
// "budget dashboard" alongside the finance-facing roles.
export function canAccessPage(user: CurrentUser, page: Page): boolean {
  if (isSuperadmin(user)) return true;

  switch (page) {
    case "submit":
    case "my":
      return true;
    case "procurement":
      return hasRole(user, "PROCUREMENT");
    case "bo-approvals":
      return hasRole(user, "BO");
    case "ceo-approvals":
      return hasRole(user, "CEO");
    case "accounting":
      return hasRole(user, "ACCOUNTING");
    case "dashboard":
      return hasRole(user, "CEO") || hasRole(user, "ACCOUNTING");
    case "settings":
      // Visible to every role except a pure EMPLOYEE (or a user with no
      // roles at all, though auto-registration means that's now transient
      // — see lib/auth.ts). Which *tabs* they see once there is a separate,
      // finer-grained question — see canAccessSettingsTab below.
      return user.allRoles.some((r) => r.role !== "EMPLOYEE");
  }
}

// --- Settings tab permissions ---------------------------------------------

export type SettingsTab = "suppliers" | "users" | "products" | "categories" | "deptconfig" | "announcements";

export const SETTINGS_TABS: SettingsTab[] = [
  "suppliers",
  "users",
  "products",
  "categories",
  "deptconfig",
  "announcements",
];

// SUPERADMIN is deliberately omitted from each list — canAccessSettingsTab
// grants it unconditionally below, same convention as canAccessPage.
const SETTINGS_TAB_ROLES: Record<SettingsTab, Role[]> = {
  suppliers: ["ACCOUNTING", "PROCUREMENT"],
  users: [],
  products: ["PROCUREMENT"],
  categories: [],
  deptconfig: ["CEO"],
  announcements: ["CEO"],
};

export function canAccessSettingsTab(user: CurrentUser, tab: SettingsTab): boolean {
  if (isSuperadmin(user)) return true;
  return hasAnyRole(user, SETTINGS_TAB_ROLES[tab]);
}

// First tab (in SETTINGS_TABS order) this user can actually see — used to
// redirect away from a tab they don't have permission for. null means they
// can access /settings at all (canAccessPage) but hold no role that grants
// any individual tab (e.g. a BO-only user — BO isn't listed for any tab
// above; the page shows an empty state rather than looping on a redirect).
export function firstAccessibleSettingsTab(user: CurrentUser): SettingsTab | null {
  return SETTINGS_TABS.find((tab) => canAccessSettingsTab(user, tab)) ?? null;
}

// --- BO scope matching ---------------------------------------------------

function scopeMatches(scope: string, value: string | null | undefined): boolean {
  if (scope === "*") return true;
  if (!value) return false;
  return scope
    .split(",")
    .map((s) => s.trim())
    .includes(value);
}

export function boScopeMatchesRequest(scope: RoleRow, request: ExpenseRequest): boolean {
  return (
    scopeMatches(scope.bu_scope, request.bu) &&
    scopeMatches(scope.dept_scope, request.department) &&
    scopeMatches(scope.cat_l1_scope, request.cat_l1)
  );
}

// A user can hold several BO rows (different scopes). They can see/act on a
// request if ANY of their BO scope rows matches it.
export function canBoActOnRequest(user: CurrentUser, request: ExpenseRequest): boolean {
  if (isSuperadmin(user)) return true;
  return rolesOf(user, "BO").some((scope) => boScopeMatchesRequest(scope, request));
}

// Shared by GET /api/requests/[id] and the homepage's payment
// calendar/stats endpoints — "can this user see this request at all"
// (separate from "can they act on it").
export function canViewRequest(user: CurrentUser, request: ExpenseRequest): boolean {
  if (isSuperadmin(user)) return true;
  if (request.requester_email === user.email) return true;
  if (hasRole(user, "CEO") || hasRole(user, "ACCOUNTING") || hasRole(user, "PROCUREMENT")) {
    return true;
  }
  if (hasRole(user, "BO")) return canBoActOnRequest(user, request);
  return false;
}

// --- dept_config score-based matching -------------------------------------
// Exact dept + exact BU + exact cat_l1  = 35
// Exact dept + exact BU + wildcard cat  = 25
// Exact dept + wildcard BU + wildcard cat = 15
// Wildcard dept (fallback row)          = -5
// (BU/cat_l1 exact vs wildcard combine additively; only the two documented
// combinations above are guaranteed to occur in configured data, but the
// formula generalizes: dept match = 15 pts, +10 per exact bu/cat_l1 match.)
export function scoreDeptConfig(
  config: DeptConfigRow,
  target: { bu: string; department: string; cat_l1: string | null },
): number | null {
  if (config.dept === "*") return -5;
  if (config.dept !== target.department) return null;

  let score = 15;
  if (config.bu !== "*") {
    if (config.bu !== target.bu) return null;
    score += 10;
  }
  if (config.cat_l1 !== "*") {
    if (config.cat_l1 !== target.cat_l1) return null;
    score += 10;
  }
  return score;
}

export function matchDeptConfig(
  configs: DeptConfigRow[],
  target: { bu: string; department: string; cat_l1: string | null },
): DeptConfigRow | null {
  let best: { config: DeptConfigRow; score: number } | null = null;
  for (const config of configs) {
    const score = scoreDeptConfig(config, target);
    if (score === null) continue;
    if (!best || score > best.score) {
      best = { config, score };
    }
  }
  return best?.config ?? null;
}

// --- CEO signature logic ---------------------------------------------------
// ceo_signature_required=true AND exceed_amount>0 -> sign only if total > exceed_amount
// ceo_signature_required=true AND exceed_amount=0 -> always sign
// ceo_signature_required=false -> never sign
export function computeCeoSignatureRequired(
  config: DeptConfigRow | null,
  total: number,
): boolean {
  if (!config || !config.ceo_signature_required) return false;
  if (config.exceed_amount > 0) return total > config.exceed_amount;
  return true;
}

// --- rejection history visibility ------------------------------------------
// CEOs only see rejection log entries they personally authored at the CEO
// stage; rejections from other stages (procurement/BO) remain visible to
// everyone who can see the request.
export function visibleRejectionHistory(
  history: RejectionHistoryEntry[],
  user: CurrentUser,
): RejectionHistoryEntry[] {
  if (isSuperadmin(user) || !hasRole(user, "CEO")) return history;

  return history.filter(
    (entry) => entry.stage !== "CEO_APPROVED" || entry.actor_email === user.email,
  );
}
