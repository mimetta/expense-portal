-- Call log for the read-only outbound API (/api/external/v1/*).
--
-- ONE TABLE SERVING TWO REQUIREMENTS, deliberately:
--
--   1. "log every call with the timestamp and endpoint" — a row per request.
--   2. the rate limit — counted from these rows.
--
-- The rate limit reads the log rather than an in-process counter because this
-- app runs on Vercel: every lambda instance would keep its own counter, so an
-- in-memory limiter caps each instance separately and the real ceiling
-- becomes (limit x instances), which is no ceiling at all. Counting rows is a
-- round trip per call, and at KC-Dashboard's volume that is the right trade.
--
-- NO PERSONAL DATA. key_label identifies WHICH key was used, never a person —
-- the outbound key is not attached to a user, and the whole API returns
-- aggregates only.

create table if not exists public.external_api_calls (
  id bigserial primary key,
  ts timestamptz not null default now(),
  endpoint text not null,
  -- 'kc-dashboard' etc. Never an email, never a user id.
  key_label text not null,
  status int not null,
  -- Coarse, for abuse investigation only; may be null behind a proxy.
  ip text,
  query text
);

-- The rate-limit read is "count rows for this key since <timestamp>", so the
-- index leads with key_label then ts.
create index if not exists external_api_calls_key_ts
  on public.external_api_calls (key_label, ts desc);
create index if not exists external_api_calls_ts
  on public.external_api_calls (ts desc);

alter table public.external_api_calls enable row level security;

comment on table public.external_api_calls is
  'One row per outbound-API request. Serves both the audit log and the rate limit — see migration 050. Contains no personal data.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   drop table if exists public.external_api_calls;
--
-- Dropping it disables the rate limit (lib/external-api.ts fails CLOSED if the
-- table is unreadable, so calls are refused rather than silently unlimited).
-- ---------------------------------------------------------------------------
