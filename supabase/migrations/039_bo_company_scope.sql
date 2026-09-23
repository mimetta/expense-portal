-- BO scope keys on the COMPANY THE EXPENSE IS CHARGED TO, not the BU the
-- request was filed under.
--
-- These are two different facts and were sharing one field:
--
--   people.bu             the company the PERSON is employed by. Drives petty
--                         cash holder rights and tax filing. NOT CHANGED.
--   requests.use_for_company   the company the EXPENSE is charged to. This is
--                         what decides who approves it: it is that company's
--                         budget being spent.
--
-- 291 of 1,202 requests (24%) charge to a different company than they were
-- filed under — SV->ONEST 240, ONEST->SV 51 — so this was not a theoretical
-- distinction. A person employed by SV can charge an expense to ONEST, and the
-- ONEST budget owner has to approve it.
--
-- VALUES ARE IDENTICAL, SO THE BACKFILL IS AN IDENTITY MAP. requests.
-- use_for_company holds a BU CODE, not a company id or name: the only two
-- distinct values across all 1,202 rows are 'ONEST' and 'SV', and migration
-- 012's own comment defines the column as holding `companies.bu`. The UI's
-- "ONEST — Mimetta Co., Ltd." is a display join on companies.bu. So
-- company_scope := bu_scope, verbatim, with no translation table.
--
-- bu_scope IS KEPT, frozen, as the rollback path — same pattern as the frozen
-- `roles` table. Nothing reads it after this migration. To roll back, revert
-- the code; the column is still there and still correct.

alter table public.bo_scopes
  add column if not exists company_scope text not null default '*';

update public.bo_scopes set company_scope = bu_scope where company_scope <> bu_scope;

comment on column public.bo_scopes.company_scope is
  'The company an expense is CHARGED TO (requests.use_for_company), comma-separated or ''*''. Not the filing BU — see migration 039.';
comment on column public.bo_scopes.bu_scope is
  'FROZEN as of migration 039. Superseded by company_scope; nothing reads this. Kept as the rollback path.';

-- ---------------------------------------------------------------------------
-- v_request_spend and its two aggregates gain use_for_company.
--
-- REQUIRED, not cosmetic. lib/spend.ts#scopeFilter feeds aggregate rows
-- through the SAME boScopeMatchesRequest the approval path uses. Once that
-- matcher reads use_for_company, a row that does not carry the column arrives
-- as undefined, scopeMatches returns false for every non-'*' scope, and EVERY
-- BO's spend report silently goes blank — no error, no empty-state, just zero
-- rows. The column has to exist here or the feature breaks in the quietest
-- possible way.
--
-- The column is APPENDED LAST in all three views on purpose: `create or
-- replace view` may only add columns at the end when dependent views exist,
-- and v_spend_by_segment_month/_ts both depend on v_request_spend.
--
-- Everything else in these definitions is byte-identical to migration 023 /
-- 016. The only changes are `r.use_for_company` in the base CTE, the final
-- select, and the two aggregates' select + group by.
-- ---------------------------------------------------------------------------

create or replace view public.v_request_spend as
with base as (
  select
    r.request_id,
    r.bu,
    -- Falls back to the filing BU when unset. Zero rows rely on this today
    -- (use_for_company is non-null on all 1,202 requests); it exists so a row
    -- written before the column was populated cannot silently lose its owner.
    coalesce(nullif(r.use_for_company, ''), r.bu) as use_for_company,
    r.department    as hdr_department,
    r.status,
    r.cat_l1        as hdr_cat_l1,
    r.cat_l2        as hdr_cat_l2,
    r.description   as hdr_description,
    r.total         as hdr_total,
    r.amount_net    as hdr_amount_net,
    r.items_json,
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
    (e.item is null or jsonb_typeof(e.item) = 'null') as is_headerless,
    coalesce(nullif(e.item ->> 'segment', ''), e.hdr_department) as department,
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
  extract(year  from b.submitted_at)::int as ts_fiscal_year,
  extract(month from b.submitted_at)::int as ts_month,
  b.use_for_company
from balanced b;

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
  count(*)        as line_count,
  use_for_company
from public.v_request_spend
group by bu, fiscal_year, month, department, cat_l1, cat_l2, status, use_for_company;

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
  count(*)        as line_count,
  use_for_company
from public.v_request_spend
group by bu, ts_fiscal_year, ts_month, department, cat_l1, cat_l2, status, use_for_company;

comment on view public.v_request_spend is
  'One row per request line item. `department` is the ITEM''s segment, falling back to requests.department. `use_for_company` is the company the expense is CHARGED TO and is what BO scope matches on — see migration 039.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   1. Revert the application code. bo_scopes.bu_scope is untouched and still
--      holds the pre-039 values, so approval scope returns to filing-BU with
--      no data change. company_scope may be left in place; nothing reads it.
--   2. Optionally replay the three view definitions from migration 023 (and
--      016 for the two aggregates) to drop the use_for_company column. Not
--      required — an extra trailing column breaks nothing.
-- ---------------------------------------------------------------------------
