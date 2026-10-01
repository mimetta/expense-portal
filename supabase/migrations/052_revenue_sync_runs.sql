-- Run log for the daily Google Sheets revenue sync.
--
-- A SILENTLY FAILING SYNC IS THE REAL RISK: stale data looks exactly like
-- fresh data. `revenue_goals.actual_synced_at` records when a CELL was last
-- written, which answers "when did a figure change" — not "did today's sync
-- run, and did it succeed". A sync that refuses on validation writes no cells
-- at all, so on that evidence alone a broken sync is indistinguishable from a
-- day where nothing moved.
--
-- Hence a row per ATTEMPT, success or failure. It is what the budget page
-- reads to show the last-synced time and to warn when the last SUCCESS is more
-- than 48 hours old.

create table if not exists public.revenue_sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fiscal_year integer not null,
  -- 'success' | 'validation_failed' | 'error'. Validation failure is kept
  -- distinct from an unexpected error: the first means the sheet needs a
  -- person, the second means this code or Google does.
  status text not null check (status in ('success', 'validation_failed', 'error')),
  -- 'cron' | 'manual'. A manual run that fails must not be mistaken for the
  -- scheduled one failing, and vice versa.
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by text,
  channels_matched integer,
  cells_written integer,
  cells_cleared integer,
  -- Human-readable problems. NEVER raw sheet contents and never a key: these
  -- strings are shown in the UI and posted to Discord.
  problems jsonb not null default '[]'::jsonb,
  note text
);

-- The two reads this table serves: "the most recent run" and "the most recent
-- SUCCESSFUL run". Both are a reverse scan on started_at.
create index if not exists revenue_sync_runs_started
  on public.revenue_sync_runs (started_at desc);
create index if not exists revenue_sync_runs_status_started
  on public.revenue_sync_runs (status, started_at desc);

alter table public.revenue_sync_runs enable row level security;

comment on table public.revenue_sync_runs is
  'One row per revenue sync attempt, success or failure. Backs the budget page last-synced time and the 48h staleness warning. Contains no sheet contents and no credentials.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   drop table if exists public.revenue_sync_runs;
--
-- Dropping it does not break the sync — lib/revenue-sync.ts treats a failure
-- to record a run as non-fatal, since refusing to import because the LOG is
-- unavailable would be the wrong trade. The budget page simply stops being
-- able to say when the last sync was.
-- ---------------------------------------------------------------------------
