-- Configurable, DB-backed replacement for lib/permissions.ts's previously
-- hardcoded SETTINGS_TAB_ROLES map. Lets a SUPERADMIN grant/revoke which
-- roles can both SEE and manage (add/edit/delete within) each of the other
-- 8 Settings tabs, via the new Settings > Permissions tab, instead of
-- requiring a code change + deploy for every access change. Self-contained/
-- idempotent, same CREATE TABLE IF NOT EXISTS pattern as every other
-- additive migration in this project (e.g. 007_roles_update.sql,
-- 011_chapter.sql, 015_supplier_email.sql).
--
-- `roles` is a comma-separated list of Role values (lib/constants.ts#ROLES),
-- same convention as roles.bu_scope/dept_scope/cat_l1_scope elsewhere in
-- this schema. Empty string = SUPERADMIN-only (SUPERADMIN itself is never
-- stored here — it's always implicitly granted everywhere, same convention
-- the original hardcoded SETTINGS_TAB_ROLES map used). The "permissions"
-- tab itself deliberately has no row here — it's SUPERADMIN-only, hardcoded
-- in application code, and not configurable through itself (see
-- lib/permissions.ts#canAccessSettingsTab), to avoid a self-referential
-- lockout or privilege-escalation risk.
CREATE TABLE IF NOT EXISTS settings_tab_permissions (
  tab TEXT PRIMARY KEY,
  roles TEXT NOT NULL DEFAULT ''
);

-- Seeded to byte-for-byte match the OLD hardcoded SETTINGS_TAB_ROLES values,
-- so behavior is unchanged until an admin explicitly edits something
-- through the new Permissions tab. ON CONFLICT DO NOTHING makes this
-- idempotent alongside CREATE TABLE IF NOT EXISTS above.
INSERT INTO settings_tab_permissions (tab, roles) VALUES
  ('suppliers', 'ACCOUNTING,PROCUREMENT'),
  ('users', ''),
  ('products', 'PROCUREMENT'),
  ('categories', ''),
  ('deptconfig', 'CEO'),
  ('announcements', 'CEO'),
  ('pettycash', 'ACCOUNTING'),
  ('companies', '')
ON CONFLICT (tab) DO NOTHING;
