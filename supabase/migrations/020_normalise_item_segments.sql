-- Mimetta Expense Portal — normalise legacy items_json[].segment spellings
--
-- Follow-on to the categories reconciliation (migrations 018-019). Same
-- snapshot + audit + verify-or-abort pattern as 019.
--
-- WHY: v_request_spend is being changed to group by the item's `segment`
-- rather than the header `department`. Six legacy spellings survive in
-- items_json that are not in lib/constants.ts#DEPARTMENTS, so the moment that
-- change lands they become orphan segments carrying ThB 339,119 of FY2026
-- approved spend. These are the SAME legacy spellings that
-- scripts/fix-department-names-everywhere.ts normalised in
-- requests.department on 2026-07-24 (see the DEPARTMENT_WEBHOOK_ENV comment
-- in lib/constants.ts) — that pass swept the flat column and missed the
-- JSONB array. This is the same drift, one field deeper.
--
--   Store Investment             -> New Store Investment   12 items
--   Marketing (MKT)              -> Marketing              11 items
--   COGs                         -> COG                    10 items
--   General Administrative (GA)  -> General Administrative   6 items
--   People & HR & System         -> People (HR)              4 items
--   Fulfillment operation        -> Operations/Fulfillment    4 items
--                                                     total 47 items
--                                                    across 40 requests
--
-- Every mapping is corroborated by the header department already present on
-- the affected requests, which was normalised in the 2026-07-24 pass.
-- Verified before writing this: for all 40 requests, normalising item[0]
-- yields exactly the header department already stored, so the flat
-- requests.department column (derived from item[0] by the "first item wins"
-- convention) does not change and is not touched here.
--
-- NOT IN SCOPE — 2 items with a missing `segment` key, left untouched:
--   EXP-2026-03-000017 item[0]   ONEST, header department '', status EXPIRED
--   EXP-2026-04-000046 item[0]   ONEST, header department '', status EXPIRED
-- Both are empty placeholder items — no segment, no cat_l1, no cat_l2, blank
-- description, amount_net 0 — on EXPIRED requests whose header department is
-- also blank. They carry no spend and no information to infer a segment from.
-- Guessing one would invent an attribution; they are reported, not fixed.
--
-- IN SCOPE, and worth noting: EXP-2026-07-000132 and EXP-2026-07-000116 were
-- deliberately excluded from 019 because their HEADER department was correct
-- and only an item was mislabelled. Their item segments are squarely in scope
-- here — 019 skipped remapping their headers, this fixes their items:
--   EXP-2026-07-000132  [People (HR) x3, COGs] -> [People (HR) x3, COG]
--   EXP-2026-07-000116  [People (HR), Fulfillment operation,
--                        General Administrative (GA)]
--                    -> [People (HR), Operations/Fulfillment,
--                        General Administrative]

-- ---------------------------------------------------------------------------
-- Snapshot table. Stores the WHOLE original items_json per request rather
-- than a per-item diff: the array is the unit that gets rewritten, and a
-- whole-value snapshot makes rollback a single assignment with no risk of
-- reassembling the array wrongly.
-- ---------------------------------------------------------------------------
create table if not exists requests_items_segment_normalise_2026_08 (
  request_id          text primary key references requests (request_id) on delete cascade,
  items_json_original jsonb not null,
  items_changed       integer not null,
  normalised_at       timestamptz not null default now()
);

comment on table requests_items_segment_normalise_2026_08 is
  'Pre-change items_json for every request touched by migration 020 (legacy segment spelling normalisation). Rollback source.';

alter table requests_items_segment_normalise_2026_08 enable row level security;
grant all on requests_items_segment_normalise_2026_08 to service_role;

do $$
declare
  v_snapshot integer;
  v_updated  integer;
  v_audit    integer;
  v_left     integer;
  k_legacy   text[] := array[
    'Store Investment', 'Marketing (MKT)', 'COGs',
    'General Administrative (GA)', 'Fulfillment operation', 'People & HR & System'
  ];
begin
  -- 1. Snapshot every affected request's items_json BEFORE touching it.
  insert into requests_items_segment_normalise_2026_08 (request_id, items_json_original, items_changed)
  select
    r.request_id,
    r.items_json,
    (select count(*) from jsonb_array_elements(r.items_json) x where x ->> 'segment' = any (k_legacy))
  from requests r
  where jsonb_typeof(r.items_json) = 'array'
    and jsonb_array_length(r.items_json) > 0
    and exists (
      select 1 from jsonb_array_elements(r.items_json) x
       where x ->> 'segment' = any (k_legacy)
    );
  get diagnostics v_snapshot = row_count;

  -- 2. One audit row per request. 'system@migration' matches the convention
  --    established by 019 (and 'system@cron' before it).
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration',
    s.request_id,
    'ITEM_SEGMENT_NORMALISED',
    jsonb_build_object(
      'field', 'items_json[].segment',
      'items_changed', s.items_changed,
      'from', (
        select jsonb_agg(distinct x ->> 'segment')
          from jsonb_array_elements(s.items_json_original) x
         where x ->> 'segment' = any (k_legacy)
      ),
      'reason', 'legacy department spelling not in lib/constants.ts#DEPARTMENTS; v_request_spend will group by item segment',
      'migration', '020_normalise_item_segments',
      'rollback_source', 'requests_items_segment_normalise_2026_08'
    )
  from requests_items_segment_normalise_2026_08 s;
  get diagnostics v_audit = row_count;

  -- 3. Rewrite the arrays. ORDER BY ordinality preserves item order, which
  --    matters — requests.department/cat_l1/cat_l2 are derived from items[0].
  update requests r
     set items_json = (
           select jsonb_agg(
                    case when m.canonical is not null
                         then jsonb_set(t.it, '{segment}', to_jsonb(m.canonical))
                         else t.it end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
             left join (values
               ('Store Investment',            'New Store Investment'),
               ('Marketing (MKT)',             'Marketing'),
               ('COGs',                        'COG'),
               ('General Administrative (GA)', 'General Administrative'),
               ('Fulfillment operation',       'Operations/Fulfillment'),
               ('People & HR & System',        'People (HR)')
             ) as m(legacy, canonical) on m.legacy = t.it ->> 'segment'
         ),
         updated_at = now()
    from requests_items_segment_normalise_2026_08 s
   where r.request_id = s.request_id
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_updated = row_count;

  -- 4. Verify or abort. RAISE rolls the whole migration back.
  if v_snapshot <> v_updated then
    raise exception 'ABORT: snapshot rows (%) <> updated rows (%).', v_snapshot, v_updated;
  end if;

  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  select count(*) into v_left
    from requests r, jsonb_array_elements(r.items_json) x
   where jsonb_typeof(r.items_json) = 'array'
     and x ->> 'segment' = any (k_legacy);
  if v_left <> 0 then
    raise exception 'ABORT: % item(s) still carry a legacy segment spelling.', v_left;
  end if;

  raise notice 'normalised item segments on % requests (% snapshot, % audit rows)',
    v_updated, v_snapshot, v_audit;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   update requests r
--      set items_json = s.items_json_original,
--          updated_at = now()
--     from requests_items_segment_normalise_2026_08 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'ITEM_SEGMENT_NORMALISED'
--     and detail_json ->> 'migration' = '020_normalise_item_segments';
--
--   delete from requests_items_segment_normalise_2026_08;
--
-- Because the snapshot holds the entire original array, the first statement
-- restores items_json exactly as it was — no per-item reassembly.
-- ---------------------------------------------------------------------------
