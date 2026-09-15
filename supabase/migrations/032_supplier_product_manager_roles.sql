-- New roles: SUPPLIER_MANAGER, PRODUCT_MANAGER. Same drop-and-recreate
-- treatment every prior role addition to roles.role has used (see
-- 012_new_features.sql for PETTY_CASH_CUSTODIAN, supabase/pending/
-- 015_budget_cashflow.sql for DEPT_HEAD — that statement was already run by
-- hand against the live database, so DEPT_HEAD is live even though the rest
-- of that file isn't applied; this constraint layers on top of that live
-- state, not the file's original one).
--
-- Purpose: today, granting someone "just" Supplier or Product management
-- means giving them a whole existing role (ACCOUNTING or PROCUREMENT),
-- which also bundles in unrelated powers (the Accounting page/Mark Paid,
-- or the Procurement page/PO workflow actions) they may not need. These
-- two roles carry no page access or request-approval powers of their own —
-- canAccessPage's generic "any role except a pure EMPLOYEE" rule
-- (lib/permissions.ts) still grants them the Settings page, and which tab
-- they see there is governed entirely by the existing, already-dynamic
-- Settings > Permissions config (DEFAULT_SETTINGS_TAB_ROLES / the
-- settings_tab_permissions table) — no new permission mechanism needed,
-- these roles just plug into the one that already exists.
alter table roles drop constraint if exists roles_role_check;
alter table roles add constraint roles_role_check check (role in (
  'SUPERADMIN', 'CEO', 'ACCOUNTING', 'BO', 'PROCUREMENT', 'EMPLOYEE',
  'PETTY_CASH_CUSTODIAN', 'DEPT_HEAD', 'SUPPLIER_MANAGER', 'PRODUCT_MANAGER'
));

-- Also grant these two roles the corresponding Settings tab, in the live
-- settings_tab_permissions data (migration 024) — NOT just in code's
-- DEFAULT_SETTINGS_TAB_ROLES fallback. getSettingsTabPermissions()
-- (lib/settings-permissions.ts) fully REPLACES a tab's default with
-- whatever row already exists in this table, so once 024 has been applied
-- (it has — see CLAUDE.md), the code-level default is dead for these two
-- tabs and only this data update actually changes what a freshly assigned
-- SUPPLIER_MANAGER/PRODUCT_MANAGER can see. Appends rather than overwrites,
-- so any admin customization already made via Settings > Permissions is
-- preserved; guarded by NOT LIKE so re-running this migration is a no-op.
update settings_tab_permissions
set roles = case when roles = '' then 'SUPPLIER_MANAGER' else roles || ',SUPPLIER_MANAGER' end
where tab = 'suppliers' and roles not like '%SUPPLIER_MANAGER%';

update settings_tab_permissions
set roles = case when roles = '' then 'PRODUCT_MANAGER' else roles || ',PRODUCT_MANAGER' end
where tab = 'products' and roles not like '%PRODUCT_MANAGER%';
