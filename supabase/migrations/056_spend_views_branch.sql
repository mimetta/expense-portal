-- Add `branch` to the spend views, so branch budget can be compared with
-- branch spend.
--
-- WHERE A BRANCH COMES FROM. Retail already records one: requests.product for
-- a normal Retail request, and items_json[].product per line for Retail petty
-- cash (see CLAUDE.md, "Per-item Branch/Product"). The item wins and the header
-- is the fallback — the identical precedence department/cat_l1/cat_l2 already
-- use in this view, so a branch follows the same rule as every other
-- coordinate rather than a special one.
--
-- APPENDED LAST IN BOTH VIEWS, ON PURPOSE. `create or replace view` may only
-- add columns at the END while dependent views exist — the same constraint
-- migration 039 hit adding use_for_company, and the reason that column sits
-- last today.
--
-- NOT RECONCILED, DELIBERATELY. The branch names in spend do not all match the
-- channel list: FY2026 Retail spend carries "Dusit Central Park", "Gaysorn
-- Amarin", "Nextopia (Ecotopia)" and "All branch", none of which is a channel.
-- This migration exposes the value as recorded and changes no data; mapping or
-- correcting those names is a separate decision with its own evidence, not
-- something to slip into a view definition.
--
-- ROLLBACK: re-run migration 039's two view definitions verbatim.

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
    r.product       as hdr_product,
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
    coalesce(nullif(e.item ->> 'product', ''), e.hdr_product) as branch,
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
  b.use_for_company,
  b.branch
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
  use_for_company,
  branch
from public.v_request_spend
group by bu, fiscal_year, month, department, cat_l1, cat_l2, status, use_for_company, branch;
