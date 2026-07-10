-- Homepage calendar feature (see CLAUDE.md "Homepage Calendar"). Self-
-- contained and idempotent (CREATE TABLE IF NOT EXISTS), same pattern as
-- 008_announcements.sql. Not yet applied to the live database as of this
-- writing — apply manually (Supabase SQL editor, or `supabase db push`
-- with real credentials); this agent environment has no
-- SUPABASE_ACCESS_TOKEN.

CREATE TABLE IF NOT EXISTS calendar_events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'general',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Not enforced by a CHECK constraint — the app validates event_type
-- against this same list client- and server-side (see
-- lib/constants.ts#CALENDAR_EVENT_TYPES), matching the pattern used for
-- `requests.status` elsewhere in this schema being the one column that
-- *does* get a CHECK (it's the one column with real state-machine
-- transitions to protect); a free-text tag like this doesn't need one.
-- Valid values: 'payment', 'deadline', 'reminder', 'important', 'general'.

CREATE INDEX IF NOT EXISTS calendar_events_event_date_idx ON calendar_events (event_date);
