-- Chapter field (see CLAUDE.md "Chapter field"). Self-contained and
-- idempotent (ADD COLUMN IF NOT EXISTS), same pattern as every other
-- migration in this project. Not yet applied to the live database as of
-- this writing — apply manually (Supabase SQL editor, or `supabase db
-- push` with real credentials); this agent environment has no
-- SUPABASE_ACCESS_TOKEN.

-- Per-user chapter, set by an admin (no UI writes this yet — see
-- CLAUDE.md). Auto-fills the read-only Chapter field on /submit.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS chapter TEXT;

-- Snapshot of the submitting user's chapter at submission time, so a
-- request's chapter doesn't silently change if the requester's roles row
-- is edited later — same reasoning as requester_name/requester_email
-- already being copied onto the request rather than joined live.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS chapter TEXT;
