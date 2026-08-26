-- Mimetta Expense Portal — Spend Report: budgets table + spend views
--
-- NUMBERED 016, NOT 007. The spec for this feature asked for
-- `007_budgets.sql`, but 007 has been taken by 007_roles_update.sql since
-- the auto-registration batch, and this project is already up to
-- 015_budget_cashflow.sql. Same reasoning 007_roles_update.sql itself
-- records for having been renumbered off 006.
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as every prior migration in this
-- project.
--
-- Run order: assumes 001-015 already applied.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- budgets — per-month budget figures at (bu, department, product, cat_l1,
-- cat_l2) granularity.
--
-- This is deliberately a NEW table rather than an extension of the existing
-- budget_2026, which is a wide single-year table (jan..dec columns, no year
-- column — see CLAUDE.md "Database Schema") and is currently EMPTY (0 rows,
-- confirmed live). budget_2026 is left untouched: /api/dashboard/budget still
-- references it, and nothing here needs to disturb that.
-- ---------------------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  bu text not null,
  department text not null,
  product text,
  cat_l1 text,
  cat_l2 text,
  fiscal_year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- coalesce(...,'') in the key so NULL product/cat_l1/cat_l2 still collide —
-- a plain unique index over nullable columns would let unlimited duplicate
-- "department-level, no category" rows through, since NULL <> NULL in SQL.
-- This is also the ON CONFLICT target scripts/import-budget.ts upserts on.
create unique index if not exists budgets_uniq on public.budgets (
  bu, department, coalesce(product, ''), coalesce(cat_l1, ''), coalesce(cat_l2, ''),
  fiscal_year, month
);

create index if not exists budgets_lookup on public.budgets (bu, fiscal_year, month, department);

-- ---------------------------------------------------------------------------
-- RLS — default deny, no policies.
--
-- The spec for this feature asked for "all authenticated users may SELECT;
-- only SUPERADMIN / ACCOUNTING / CEO may INSERT / UPDATE / DELETE", qualified
-- with "following the existing convention in the repo". Those two halves
-- conflict, and the convention wins: every table in this schema
-- (001_initial_schema.sql lines 244-251, and 008/010/015 since) enables RLS
-- and grants NO policies to anon/authenticated, because roles live in the
-- `roles` table and permission logic is application-layer only
-- (lib/permissions.ts) — see CLAUDE.md "Access model". There is no
-- auth.jwt()-readable role claim to write a SUPERADMIN/ACCOUNTING/CEO policy
-- against without duplicating the whole multi-row, comma-separated-scope
-- role model in SQL, where it would immediately drift from lib/permissions.ts.
--
-- The equivalent enforcement lives in app/api/spend-report/route.ts
-- (canAccessPage) and lib/spend.ts (scope filtering via the same
-- boScopeMatchesRequest helper /bo-approvals uses).
-- ---------------------------------------------------------------------------
alter table public.budgets enable row level security;

-- ---------------------------------------------------------------------------
-- v_request_spend — one row per request LINE ITEM, so category drill-down is
-- accurate.
--
-- CORRECTIONS TO THE SPEC'S DRAFT, all verified against the live schema and
-- 991 live rows before finalising:
--
--  1. `r.id` does not exist. requests' primary key is `request_id` (text,
--     EXP-YYYY-MM-NNNNNN). Dropped the phantom column.
--
--  2. `budget_period` IS usable as the period field — 991/991 live rows hold
--     a valid 'YYYY-MM' string (all 2026). But it is TEXT, not a date, so
--     extract(year from ...) would error; it is parsed with to_date here.
--
--  3. The fallback is r."timestamp", NOT r.created_at. created_at is when the
--     row was INSERTED, which for the ~825 legacy rows imported by
--     scripts/import-expensedb-requests.ts is all 2026-07-21 — using it would
--     collapse three quarters of the history into one month. "timestamp" is
--     the real submission date.
--
--  4. Items carry NO 'total' key. Verified across all 991 requests: zero
--     items have one. The real item shape is {cat_l1, cat_l2, segment,
--     vat_rate, wht_rate, amount_net, description, product_code, ...}. So a
--     coalesce(item->>'total', item->>'amount_net', r.total) chain as drafted
--     would silently fall through to amount_net — which is PRE-VAT, while
--     r.total is post-VAT/WHT — and every multi-item request would
--     under-report. Item gross is instead DERIVED consistently with the
--     header: amount_net + VAT - WHT.
--
--  5. There is no 'DRAFT' status in this schema. The real set is SUBMITTED,
--     PO_UPLOADED, BO_APPROVED, CEO_APPROVED, PAID, REJECTED, EDIT_REQUESTED,
--     EXPIRED (lib/constants.ts#STATUSES). Excluding only REJECTED/EXPIRED.
--
--  6. Reconciliation. With gross derived as above, item sums match r.total
--     for 983/991 requests; 8 diverge (max ฿586.81). Those get r.total
--     allocated proportionally by line, per spec. The last line of EVERY
--     request additionally absorbs any residual rounding difference, so
--     sum(amount) per request is EXACTLY r.total — without that, rounding
--     each proportional share to 2dp leaves a few satang of drift per
--     request, which compounds across ~1000 requests into a visible
--     mismatch between the segment table and the request totals.
-- ---------------------------------------------------------------------------
create or replace view public.v_request_spend as
with base as (
  select
    r.request_id,
    r.bu,
    r.department,
    r.status,
    r.cat_l1        as hdr_cat_l1,
    r.cat_l2        as hdr_cat_l2,
    r.description   as hdr_description,
    r.total         as hdr_total,
    r.amount_net    as hdr_amount_net,
    r.items_json,
    -- budget_period ('YYYY-MM' text) is the accounting period the submitter
    -- assigned the spend to; "timestamp" (real submission time) is the
    -- fallback when it is somehow blank.
    coalesce(
      to_date(nullif(r.budget_period, ''), 'YYYY-MM'),
      r."timestamp"::date
    ) as period_at,
    r."timestamp"::date as submitted_at
  from public.requests r
  where r.status not in ('REJECTED', 'EXPIRED')
),
expanded as (
  select
    b.*,
    t.item,
    t.item_no
  from base b
  left join lateral jsonb_array_elements(
    case
      when jsonb_typeof(b.items_json) = 'array' and jsonb_array_length(b.items_json) > 0
      then b.items_json
      else '[null]'::jsonb
    end
  ) with ordinality as t(item, item_no) on true
),
priced as (
  select
    e.*,
    -- jsonb_array_elements over '[null]'::jsonb yields a JSON null, which is
    -- NOT SQL NULL — both forms have to be tested for the no-items case.
    (e.item is null or jsonb_typeof(e.item) = 'null') as is_headerless,
    coalesce(nullif(e.item ->> 'cat_l1', ''), e.hdr_cat_l1) as cat_l1,
    coalesce(nullif(e.item ->> 'cat_l2', ''), e.hdr_cat_l2) as cat_l2,
    coalesce(nullif(e.item ->> 'description', ''), e.hdr_description) as description,
    case
      when e.item is null or jsonb_typeof(e.item) = 'null' then e.hdr_amount_net
      else coalesce((e.item ->> 'amount_net')::numeric, 0)
    end as raw_net
  from expanded e
),
grossed as (
  select
    p.*,
    case
      when p.is_headerless then p.hdr_total
      -- Items have no 'total' key in this schema (see note 4); the coalesce
      -- is kept only so a future writer that starts emitting one is honoured.
      else coalesce(
        (p.item ->> 'total')::numeric,
        round(
          p.raw_net
            * (1
               + coalesce((p.item ->> 'vat_rate')::numeric, 0) / 100
               - coalesce((p.item ->> 'wht_rate')::numeric, 0) / 100),
          2
        )
      )
    end as raw_gross
  from priced p
),
summed as (
  select
    g.*,
    sum(g.raw_gross) over w as req_raw_gross,
    sum(g.raw_net)   over w as req_raw_net,
    count(*)         over w as req_lines
  from grossed g
  window w as (partition by g.request_id)
),
scaled as (
  select
    s.*,
    -- Within 1 THB the item figures are trusted as-is; beyond that the
    -- header total is allocated proportionally across the lines.
    case
      when abs(coalesce(s.req_raw_gross, 0) - s.hdr_total) <= 1 then s.raw_gross
      when coalesce(s.req_raw_gross, 0) <> 0
        then round(s.hdr_total * s.raw_gross / s.req_raw_gross, 2)
      else round(s.hdr_total / s.req_lines, 2)
    end as amount_scaled,
    case
      when abs(coalesce(s.req_raw_net, 0) - s.hdr_amount_net) <= 1 then s.raw_net
      when coalesce(s.req_raw_net, 0) <> 0
        then round(s.hdr_amount_net * s.raw_net / s.req_raw_net, 2)
      else round(s.hdr_amount_net / s.req_lines, 2)
    end as net_scaled
  from summed s
),
balanced as (
  select
    sc.*,
    sum(sc.amount_scaled) over w as scaled_gross_sum,
    sum(sc.net_scaled)    over w as scaled_net_sum,
    row_number() over (partition by sc.request_id order by sc.item_no desc) as rn_from_end
  from scaled sc
  window w as (partition by sc.request_id)
)
select
  b.request_id,
  b.bu,
  b.department,
  b.status,
  b.cat_l1,
  b.cat_l2,
  b.description,
  b.period_at,
  -- The last line of each request absorbs the rounding residual so that
  -- sum(amount) group by request_id is exactly requests.total.
  case
    when b.rn_from_end = 1 then b.amount_scaled + (b.hdr_total - b.scaled_gross_sum)
    else b.amount_scaled
  end as amount,
  case
    when b.rn_from_end = 1 then b.net_scaled + (b.hdr_amount_net - b.scaled_net_sum)
    else b.net_scaled
  end as amount_net,
  extract(year  from b.period_at)::int   as fiscal_year,
  extract(month from b.period_at)::int   as month,
  -- Second period derivation, so lib/spend.ts#SPEND_PERIOD_FIELD can be
  -- flipped to 'timestamp' without editing SQL (it reads the matching
  -- aggregate view below).
  extract(year  from b.submitted_at)::int as ts_fiscal_year,
  extract(month from b.submitted_at)::int as ts_month
from balanced b;

-- ---------------------------------------------------------------------------
-- Pre-aggregated spend, so lib/spend.ts can pull a whole fiscal year in ONE
-- request instead of grouping ~1900 line rows client-side or issuing a query
-- per month. PostgREST has no GROUP BY, so the grouping has to live in a view.
--
-- Grouped by status (not by an approved/paid bucket) so that
-- lib/spend.ts#ACTUAL_APPROVED / ACTUAL_PAID / PENDING_STATUS stay the single
-- source of truth for bucketing and this view never needs to change when they
-- do.
-- ---------------------------------------------------------------------------
create or replace view public.v_spend_by_segment_month as
select
  bu,
  fiscal_year,
  month,
  department,
  cat_l1,
  cat_l2,
  status,
  sum(amount)     as amount,
  sum(amount_net) as amount_net,
  count(*)        as line_count
from public.v_request_spend
group by bu, fiscal_year, month, department, cat_l1, cat_l2, status;

-- Same aggregate keyed on the submission timestamp instead of budget_period
-- — the target for SPEND_PERIOD_FIELD = 'created_at'. budget_period is
-- currently clean (991/991 valid) so this is unused, but it exists so the
-- constant is genuinely flippable, as the spec requires.
create or replace view public.v_spend_by_segment_month_ts as
select
  bu,
  ts_fiscal_year as fiscal_year,
  ts_month       as month,
  department,
  cat_l1,
  cat_l2,
  status,
  sum(amount)     as amount,
  sum(amount_net) as amount_net,
  count(*)        as line_count
from public.v_request_spend
group by bu, ts_fiscal_year, ts_month, department, cat_l1, cat_l2, status;

-- 002_service_role_grants.sql's ALTER DEFAULT PRIVILEGES covers tables
-- created after it, but views created by a later migration are owned by the
-- migrating role and do not always inherit them predictably — grant
-- explicitly, same defensive reasoning 002 records for tables.
grant select on public.v_request_spend to service_role;
grant select on public.v_spend_by_segment_month to service_role;
grant select on public.v_spend_by_segment_month_ts to service_role;
grant all on public.budgets to service_role;
