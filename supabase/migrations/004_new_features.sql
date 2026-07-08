-- Mimetta Expense Portal — settings page, slip receiver, EXPIRED removal
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials). Verified against the live `requests` table
-- immediately before writing this migration: 0 rows exist, so rewriting the
-- status CHECK constraint below is safe (no historical EXPIRED rows to
-- migrate or orphan).

-- ---------------------------------------------------------------------------
-- requests: new columns
-- ---------------------------------------------------------------------------
alter table requests add column if not exists account_no text;
alter table requests add column if not exists slip_receiver_email text;

-- ---------------------------------------------------------------------------
-- requests.status: drop EXPIRED (cron job removed, feature retired). The
-- inline check constraint Postgres generated for the original `check (...)`
-- column definition is named "requests_status_check" by default; drop it by
-- that name and re-add without EXPIRED. If the live constraint name differs,
-- the DROP is a no-op (guarded by IF EXISTS) and the ADD still succeeds,
-- layering on a second constraint that also excludes EXPIRED — redundant
-- but harmless.
-- ---------------------------------------------------------------------------
alter table requests drop constraint if exists requests_status_check;
alter table requests add constraint requests_status_check check (status in (
  'SUBMITTED', 'PO_UPLOADED', 'BO_APPROVED', 'CEO_APPROVED', 'PAID', 'REJECTED'
));

-- ---------------------------------------------------------------------------
-- suppliers (Settings > Supplier Management)
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id bigserial primary key,
  name text not null,
  payment_method text,
  bank_name text,
  account_no text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists suppliers_name_idx on suppliers (name);

-- ---------------------------------------------------------------------------
-- products (Settings > Product/SKU Management)
-- ---------------------------------------------------------------------------
create table if not exists products (
  id bigserial primary key,
  sku_code text,
  product_name text not null,
  department text,
  bu text,
  created_at timestamptz default now()
);

create index if not exists products_dept_bu_idx on products (department, bu);

-- ---------------------------------------------------------------------------
-- RLS: default deny for anon/authenticated, consistent with every other
-- table (see 001_initial_schema.sql). service_role bypasses RLS and already
-- has table/sequence grants via `alter default privileges` in
-- 002_service_role_grants.sql, so no additional grants are needed here.
-- ---------------------------------------------------------------------------
alter table suppliers enable row level security;
alter table products enable row level security;
