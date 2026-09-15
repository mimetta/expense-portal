-- Saved payment details ("presets") — lets any requester save their own
-- supplier/bank/account combo once and reuse it on future submissions,
-- without touching the shared, admin-managed `suppliers` table (Settings >
-- Supplier Management) at all. Personal and self-service by design: no
-- Settings tab, no role/permission gate beyond being signed in — every
-- `@mimetta.co` user manages only their own rows via `owner_email`.
--
-- Unlike `saved_signatures` (one row per user — a single reusable value),
-- this is a *list* per user, so it needs its own bigserial id, matching the
-- suppliers/products/companies convention rather than saved_signatures'
-- single-row-per-email shape.
--
-- Self-contained/idempotent (CREATE TABLE IF NOT EXISTS), same pattern as
-- every other migration since 008_announcements.sql — safe regardless of
-- what order migrations land in.
create table if not exists payment_presets (
  id bigserial primary key,
  owner_email text not null,
  name text not null,
  supplier_name text,
  pay_method text,
  bank_name text,
  card_type text,
  account_no text,
  slip_receiver_email text,
  created_at timestamptz not null default now()
);

create index if not exists payment_presets_owner_email_idx on payment_presets (owner_email);

alter table payment_presets enable row level security;
