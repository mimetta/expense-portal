-- Mimetta Expense Portal — recategorise COG › Raw Materials one level down.
--
-- Same snapshot + audit + verify-or-abort pattern as migrations 019 and 020.
--
-- WHAT IS WRONG. 113 requests are filed against COG with cat_l1 = 'Raw
-- Materials' and a blank cat_l2. `categories` has no such cat_l1 under COG:
-- 'Raw Materials' exists one level DOWN, as a cat_l2 under
-- 'Direct Material - COG'. So this spend — ฿1.66M ONEST + ฿576k SV in FY2026
-- — sits at a coordinate no budget can be set against and no BO can approve.
--
--     cat_l1 'Raw Materials'  ->  'Direct Material - COG'
--     cat_l2 '' (blank)       ->  'Raw Materials'
--
-- Both companies. Header AND the matching items_json entries, because
-- v_request_spend reads the ITEM's segment/cat_l1/cat_l2 with the header only
-- as a fallback (migration 023) — changing the header alone would leave the
-- spend report unmoved.
--
-- NO MONEY MOVES. Only the coordinate changes: every amount, company and
-- department stays exactly as it is, so FY2026 totals for ONEST, SV and All
-- are unchanged to the satang and only COG's internal split shifts.
--
-- PRECONDITION, CHECKED BELOW AND ABORTING IF UNMET: the target
-- (bu, COG, Direct Material - COG, Raw Materials) must already exist and be
-- active in `categories` for BOTH ONEST and SV. Verified before writing: one
-- active row each.
--
-- ROLLBACK (step 1 only, independent of migrations 044-046):
--
--   update requests r
--      set cat_l1 = s.cat_l1_original,
--          cat_l2 = s.cat_l2_original,
--          items_json = s.items_json_original
--     from requests_cog_raw_materials_2026_09 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_RECATEGORISED'
--     and detail_json ->> 'migration' = '043_recategorise_cog_raw_materials';
--
-- ---------------------------------------------------------------------------

create table if not exists requests_cog_raw_materials_2026_09 (
  request_id text primary key,
  cat_l1_original text,
  cat_l2_original text,
  items_json_original jsonb,
  items_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table requests_cog_raw_materials_2026_09 is
  'Pre-change header and items_json for every request moved by migration 043 (COG Raw Materials recategorised one level down). Rollback source.';

do $$
declare
  v_missing integer;
  v_snapshot integer;
  v_headers integer;
  v_items_reqs integer;
  v_audit integer;
  k_old_l1 constant text := 'Raw Materials';
  k_new_l1 constant text := 'Direct Material - COG';
  k_new_l2 constant text := 'Raw Materials';
begin
  -- 0. PRECONDITION. Abort before touching anything if either company lacks
  --    the destination — moving spend to a coordinate that does not exist
  --    would swap one unbudgetable location for another.
  select count(*) into v_missing
    from (values ('ONEST'), ('SV')) as want(bu)
   where not exists (
     select 1 from categories c
      where c.bu = want.bu and c.department = 'COG'
        and c.cat_l1 = k_new_l1 and c.cat_l2 = k_new_l2
        and coalesce(c.active, true)
   );
  if v_missing > 0 then
    raise exception 'ABORT: % company/companies lack an active COG / % / % category.',
      v_missing, k_new_l1, k_new_l2;
  end if;

  -- 1. Snapshot every affected request WHOLE, before any write. The entire
  --    items_json is stored rather than a diff, so rollback is one assignment.
  insert into requests_cog_raw_materials_2026_09
    (request_id, cat_l1_original, cat_l2_original, items_json_original, items_changed)
  select
    r.request_id,
    r.cat_l1,
    r.cat_l2,
    r.items_json,
    coalesce((
      select count(*) from jsonb_array_elements(r.items_json) x
       where jsonb_typeof(r.items_json) = 'array' and x ->> 'cat_l1' = k_old_l1
    ), 0)
  from requests r
  where r.department = 'COG'
    and (
      r.cat_l1 = k_old_l1
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x
                       where x ->> 'cat_l1' = k_old_l1))
    )
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  -- 2. One audit row per request, actor 'system@migration' per 019/020.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration',
    s.request_id,
    'REQUEST_RECATEGORISED',
    jsonb_build_object(
      'field', 'cat_l1/cat_l2 (header and items_json)',
      'from', jsonb_build_object('cat_l1', s.cat_l1_original, 'cat_l2', s.cat_l2_original),
      'to',   jsonb_build_object('cat_l1', k_new_l1,          'cat_l2', k_new_l2),
      'items_changed', s.items_changed,
      'reason', 'cat_l1 Raw Materials does not exist under COG in categories; it is a cat_l2 under Direct Material - COG. Spend filed here could not be budgeted against or approved by any BO.',
      'amount_unchanged', true,
      'migration', '043_recategorise_cog_raw_materials',
      'rollback_source', 'requests_cog_raw_materials_2026_09'
    )
  from requests_cog_raw_materials_2026_09 s;
  get diagnostics v_audit = row_count;

  -- 3a. Header.
  update requests r
     set cat_l1 = k_new_l1,
         cat_l2 = k_new_l2,
         updated_at = now()
    from requests_cog_raw_materials_2026_09 s
   where r.request_id = s.request_id
     and r.cat_l1 = k_old_l1;
  get diagnostics v_headers = row_count;

  -- 3b. items_json. ORDER BY ordinality preserves item order, which matters —
  --     the header fields are derived from items[0] elsewhere in this app.
  update requests r
     set items_json = (
           select jsonb_agg(
                    case when t.it ->> 'cat_l1' = k_old_l1
                         then jsonb_set(jsonb_set(t.it, '{cat_l1}', to_jsonb(k_new_l1)),
                                        '{cat_l2}', to_jsonb(k_new_l2))
                         else t.it end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         ),
         updated_at = now()
    from requests_cog_raw_materials_2026_09 s
   where r.request_id = s.request_id
     and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_items_reqs = row_count;

  -- 4. Verify or abort. RAISE rolls the whole migration back.
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  if exists (
    select 1 from requests r
     where r.department = 'COG' and r.cat_l1 = k_old_l1
  ) then
    raise exception 'ABORT: header rows still carry cat_l1 = %.', k_old_l1;
  end if;

  if exists (
    select 1 from requests r, jsonb_array_elements(r.items_json) x
     where jsonb_typeof(r.items_json) = 'array'
       and r.department = 'COG' and x ->> 'cat_l1' = k_old_l1
  ) then
    raise exception 'ABORT: items_json entries still carry cat_l1 = %.', k_old_l1;
  end if;

  raise notice '043: snapshot % | audit % | headers % | item-requests %',
    v_snapshot, v_audit, v_headers, v_items_reqs;
end $$;
