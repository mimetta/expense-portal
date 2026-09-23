import type { ExpenseRequest, RoleRow } from "@/types/database";

// The BO scope matcher, MOVED here verbatim from lib/permissions.ts in stage
// 2b — not reimplemented. It lives in its own module so both
// lib/permissions.ts (legacy path) and lib/access-v2.ts (new path) can use
// the one implementation without importing each other, which would be a
// cycle. There is still exactly one copy of the comma/'*' rules.

export function scopeMatches(scope: string, value: string | null | undefined): boolean {
  if (scope === "*") return true;
  if (!value) return false;
  return scope
    .split(",")
    .map((s) => s.trim())
    .includes(value);
}

/**
 * The FIRST DIMENSION IS THE COMPANY THE EXPENSE IS CHARGED TO, not the BU it
 * was filed under (migration 039).
 *
 * `people.bu` (who employs the person) and `requests.use_for_company` (whose
 * budget is being spent) are different facts. Approval follows the money: an
 * SV employee charging an expense to ONEST needs the ONEST budget owner.
 *
 * Both sides fall back to the pre-039 field when the new one is absent, so a
 * caller that has not been updated degrades to the old behaviour rather than
 * matching nothing:
 *   - `scope.company_scope ?? scope.bu_scope` — a RoleRow synthesised without
 *     the new column still matches.
 *   - `request.use_for_company || request.bu` — `||`, not `??`, because a
 *     blank string must fall back too; `'' ?? x` is `''`, which would match
 *     nothing under any enumerated scope. Zero rows rely on this today.
 *
 * CALLERS MUST SUPPLY use_for_company. lib/spend.ts builds a synthetic object
 * from aggregate rows; if it omitted the field, every non-'*' scope would
 * match nothing and each BO's spend report would silently return zero rows.
 * That is why v_request_spend carries the column — see migration 039.
 */
export function boScopeMatchesRequest(scope: RoleRow, request: ExpenseRequest): boolean {
  return (
    scopeMatches(scope.company_scope ?? scope.bu_scope, request.use_for_company || request.bu) &&
    scopeMatches(scope.dept_scope, request.department) &&
    scopeMatches(scope.cat_l1_scope, request.cat_l1)
  );
}
