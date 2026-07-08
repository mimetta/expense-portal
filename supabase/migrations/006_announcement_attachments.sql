-- Mimetta Expense Portal — announcement photo/file attachments
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration.

alter table announcements add column if not exists attachment_url text;
alter table announcements add column if not exists attachment_type text;
