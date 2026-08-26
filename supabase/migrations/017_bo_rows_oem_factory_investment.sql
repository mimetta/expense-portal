-- Mimetta Expense Portal — grant two missing BO rows
--
-- A data change, not a schema change. Both users already hold the right
-- department scope, but on a PETTY_CASH_CUSTODIAN row — and BO logic never
-- reads those. lib/permissions.ts#canBoActOnRequest resolves scope via
-- rolesOf(user, "BO"), which filters allRoles to role = 'BO' only, so a
-- dept_scope sitting on any other role is invisible to every BO check:
-- BO approvals, /api/requests?scope=bo, and the spend report's BO filter
-- (lib/spend.ts#scopeFilter) alike.
--
-- The consequence was visible in live data. All 16 category lines under OEM
-- (both BUs) and ONEST Factory Investment had no BO in scope, and
-- EXP-2026-08-000110 (ONEST / Factory Investment / Logistic & Warehouse) was
-- stuck at SUBMITTED with skip_bo = false and no bo_approver, because no
-- BO's scope matched it. Five other Factory Investment requests were
-- BO-approved historically by siriwan.b, whose BO row is scoped to COG only
-- — i.e. approved out of scope, further evidence the BO row is what is
-- missing rather than the scope being wrong.
--
-- 1. sitanun.n@mimetta.co -> BO over OEM. They are the only person in the
--    entire roles table naming OEM in any dept_scope.
-- 2. siriwan.b@mimetta.co -> BO over Factory Investment, ALONGSIDE their
--    existing BO/COG row. This makes them the first user in this database
--    to hold more than one BO row.
--
-- Multi-row BO is supported by design, not by accident: lib/auth.ts#
-- selectRolesByEmail selects every roles row for the email with no .single()
-- and no .limit(), and canBoActOnRequest ORs across them with
-- rolesOf(user, "BO").some(...). It has simply never been exercised with
-- real data before, so it is verified against the live rows after this is
-- applied rather than assumed.
--
-- The unique constraint on (email, role, bu_scope, dept_scope, cat_l1_scope)
-- permits both: sitanun.n holds no BO row at all, and siriwan.b's existing
-- BO row differs in dept_scope ('COG' vs 'Factory Investment'). Verified
-- against live data before writing — 38 roles rows, zero duplicate composite
-- keys.
--
-- Deliberately NOT touched: both users' existing PETTY_CASH_CUSTODIAN rows,
-- siriwan.b's existing BO/COG row, sitanun.n's PROCUREMENT row, and every
-- cat_l1_scope value anywhere (the wacharanan.j / wannisa.p HR Salary
-- overlap is a separate decision).

-- Guarded with NOT EXISTS rather than ON CONFLICT DO NOTHING so the insert
-- is idempotent on its own terms and does not depend on the unique
-- constraint being present under exactly the expected name.
insert into roles (email, role, bu_scope, dept_scope, cat_l1_scope)
select 'sitanun.n@mimetta.co', 'BO', '*', 'OEM', '*'
where not exists (
  select 1 from roles
  where email = 'sitanun.n@mimetta.co'
    and role = 'BO'
    and bu_scope = '*'
    and dept_scope = 'OEM'
    and cat_l1_scope = '*'
);

insert into roles (email, role, bu_scope, dept_scope, cat_l1_scope)
select 'siriwan.b@mimetta.co', 'BO', '*', 'Factory Investment', '*'
where not exists (
  select 1 from roles
  where email = 'siriwan.b@mimetta.co'
    and role = 'BO'
    and bu_scope = '*'
    and dept_scope = 'Factory Investment'
    and cat_l1_scope = '*'
);
