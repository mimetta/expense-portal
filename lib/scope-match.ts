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

export function boScopeMatchesRequest(scope: RoleRow, request: ExpenseRequest): boolean {
  return (
    scopeMatches(scope.bu_scope, request.bu) &&
    scopeMatches(scope.dept_scope, request.department) &&
    scopeMatches(scope.cat_l1_scope, request.cat_l1)
  );
}
