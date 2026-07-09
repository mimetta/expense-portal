-- Mimetta Expense Portal — announcements table (fix: table never existed live)
--
-- This substantially duplicates 005_homepage_settings.sql +
-- 006_announcement_attachments.sql, which together define the exact same
-- table and have never been applied to the live database either (confirmed
-- live: `GET .../announcements` 404s with PGRST205). Rather than creating a
-- third file that only makes sense layered on top of two others that were
-- never applied, this one is self-contained and fully idempotent (`if not
-- exists` throughout) — applying 008 alone gets you to the same end state
-- as applying 005+006, so it supersedes needing to track those two down.
-- (005's seed welcome row is intentionally not repeated here — that's
-- content, not schema, and easy to add later via Settings > Announcements
-- if wanted; safe to skip.)
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration.

create table if not exists announcements (
  id bigserial primary key,
  title text not null,
  message text,
  is_pinned boolean default false,
  is_active boolean default true,
  attachment_url text,
  attachment_type text,
  created_by text,
  created_at timestamptz default now()
);

-- In case a database somehow already has the table from 005 but not yet
-- from 006 (or vice versa) — safe no-ops otherwise.
alter table announcements add column if not exists attachment_url text;
alter table announcements add column if not exists attachment_type text;

create index if not exists announcements_pinned_active_idx on announcements (is_active, is_pinned, created_at desc);

alter table announcements enable row level security;
