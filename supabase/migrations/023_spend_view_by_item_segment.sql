-- Mimetta Expense Portal — v_request_spend groups by the ITEM's segment
--
-- The final step of the categories reconciliation (018-022).
--
-- WHY: requests.department is a lossy summary. The submit form has no
-- separate department field at all — requests.department is derived from
-- items[0].segment by the "first item wins" convention (see
-- components/shared/RequestForm.tsx), so a request whose items span more than
-- one segment records only the first. Pairing every item's cat_l1 with that
-- single header department manufactured combinations nobody ever entered:
-- EXP-2026-08-000109 has items[0] = R&D/Product Dev and four Marketing/Brand
-- Building items, and surfaced as the non-existent (ONEST, R&D, Brand
-- Building). The item's own segment is the accurate per-line attribution.
--
-- CORRECTION (2026-08-26, on merging main). This header originally implied
-- multi-segment requests were an open-ended source of new drift. Main's
-- d91937a ("enforce one Segment per request for non-Petty-Cash") has since
-- closed most of that: for every non-Petty-Cash expense type the form now
-- copies item[0]'s segment onto any row added, broadcasts a segment change
-- to every row, and states "All items in a request must use the same
-- Segment". EXP-2026-08-000109 (ชำระแล้ว) and EXP-2026-07-000132 (Advance
-- Payment) could not be created that way today.
--
-- It is NOT closed entirely: Petty Cash is deliberately exempt from that
-- rule (isPettyCash keeps per-item segments, since one petty cash claim
-- legitimately covers several segments). EXP-2026-07-000116 is exactly that
-- — a Petty Cash request spanning People (HR), Operations/Fulfillment and
-- General Administrative — and more like it can still be created.
--
-- So this view change is not merely a historical cleanup: it remains the
-- only correct attribution for Petty Cash going forward. What changes is the
-- expected volume — a trickle from one exempt expense type, rather than from
-- every type.
--
-- SAFE NOW: migration 020 normalised the six legacy segment spellings, so
-- every items_json[].segment is a value in lib/constants.ts#DEPARTMENTS.
-- Before that, switching would have created orphan segments carrying
-- ThB 339,119.
--
-- FALLBACK: an item with no `segment` key falls back to the header
-- department rather than being dropped. Two such items exist
-- (EXP-2026-03-000017, EXP-2026-04-000046 — empty placeholder items on
-- EXPIRED requests, so excluded by this view's status filter anyway), but the
-- coalesce guards the general case: a row must never disappear from spend
-- because a field is missing. nullif('') is included because an empty-string
-- segment must fall back too, not be treated as a real department.
--
-- ONLY the derivation of `department` changes. Column list, types and order
-- are identical, so CREATE OR REPLACE works and the two dependent aggregate
-- views (v_spend_by_segment_month, v_spend_by_segment_month_ts) pick up the
-- new semantics without being touched. The proportional allocation, the
-- last-line rounding residual, the period parsing and the status filter are
-- all byte-identical to migration 016.

create or replace view public.v_request_spend as
with base as (
  select
    r.request_id,
    r.bu,
    -- Renamed from `department`: it is now the FALLBACK, not the answer.
    r.department    as hdr_department,
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
    -- THE CHANGE: the item's own segment, falling back to the header.
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
      -- Items have no 'total' key in this schema; the coalesce is kept only
      -- so a future writer that starts emitting one is honoured.
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
  -- flipped to 'timestamp' without editing SQL.
  extract(year  from b.submitted_at)::int as ts_fiscal_year,
  extract(month from b.submitted_at)::int as ts_month
from balanced b;

comment on view public.v_request_spend is
  'One row per request line item. `department` is the ITEM''s segment, falling back to requests.department when the item has no segment key — requests.department is only a first-item-wins summary and misattributes multi-segment requests.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
-- Re-run the v_request_spend definition from
-- supabase/migrations/016_budgets.sql verbatim. It is a CREATE OR REPLACE
-- VIEW with an identical column list, so replaying that block restores the
-- header-department behaviour with no other change. Concretely, the only
-- difference is in the `base` and `priced` CTEs:
--
--   base:   r.department as hdr_department      ->  r.department
--   priced: remove the line
--             coalesce(nullif(e.item ->> 'segment', ''), e.hdr_department) as department
--
-- No data is modified by this migration, so there is nothing else to undo.
-- The dependent views v_spend_by_segment_month and
-- v_spend_by_segment_month_ts revert with it automatically.
-- ---------------------------------------------------------------------------
