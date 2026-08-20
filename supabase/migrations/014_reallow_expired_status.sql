-- Mimetta Expense Portal — re-allow EXPIRED status
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration.
--
-- 004_new_features.sql dropped 'EXPIRED' from this CHECK constraint when the
-- auto-expiry cron was removed, on the assumption that "the requests table
-- was empty when this was written, so there was no historical data to
-- migrate" (see CLAUDE.md "Approval Status Flow"). That assumption no longer
-- holds: scripts/import-expensedb-requests.ts imports 36 legacy rows whose
-- true historical status is EXPIRED (PO_UPLOADED not acted on within 48h
-- under the old Google Apps Script system, before that cron existed here).
-- Re-adding 'EXPIRED' preserves that history accurately rather than
-- rewriting it to REJECTED or dropping those rows. This does not reintroduce
-- the expiry cron or any app logic that produces EXPIRED going forward —
-- it's purely a terminal, inert historical status now, same as it already
-- behaves nowhere being written to by current code paths.
--
-- Same drop-and-recreate pattern 004/009/012 used for this same constraint.

alter table requests drop constraint if exists requests_status_check;
alter table requests add constraint requests_status_check check (status in (
  'SUBMITTED', 'PO_UPLOADED', 'BO_APPROVED', 'CEO_APPROVED', 'PAID', 'REJECTED',
  'EDIT_REQUESTED', 'EXPIRED'
));
