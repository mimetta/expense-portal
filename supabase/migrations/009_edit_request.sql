-- Mimetta Expense Portal — Edit Request approval workflow
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration.

alter table requests add column if not exists edit_requested_at timestamptz;
alter table requests add column if not exists edit_requested_reason text;
alter table requests add column if not exists edit_approved_by text;
alter table requests add column if not exists edit_approved_at timestamptz;
alter table requests add column if not exists status_before_edit text;

-- New status: EDIT_REQUESTED — see CLAUDE.md "Edit Request approval
-- workflow". Same drop-and-recreate pattern 004_new_features.sql used to
-- drop EXPIRED; this time adding one.
alter table requests drop constraint if exists requests_status_check;
alter table requests add constraint requests_status_check check (status in (
  'SUBMITTED', 'PO_UPLOADED', 'BO_APPROVED', 'CEO_APPROVED', 'PAID', 'REJECTED',
  'EDIT_REQUESTED'
));
