-- Mimetta Expense Portal — auto-registration support for roles
--
-- Numbered 007, not 006 as originally requested — 006 is already taken by
-- 006_announcement_attachments.sql (see CLAUDE.md).
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration.

-- Already present in 001_initial_schema.sql (`created_at timestamptz not
-- null default now()`) — this is a no-op, kept only so this migration is
-- self-contained/idempotent if ever run against a schema that predates 001.
alter table roles add column if not exists created_at timestamptz default now();

alter table roles add column if not exists is_auto_registered boolean not null default false;
