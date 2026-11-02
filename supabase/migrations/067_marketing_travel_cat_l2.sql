-- Reconcile the old travel category name in ONEST Marketing.
--
-- Same snapshot + audit + verify-or-abort pattern as 043, 051, 059, 061.
--
--   Supporting Budget / 'ค่าเดินทาง'  ->  Supporting Budget / 'MKT ค่าเดินทาง'
--
-- Confirmed by the person who owns this data as the same line under its old
-- name. The two differ by the 'MKT ' prefix alone (4d 4b 54 20); the Thai is
-- byte-identical after it, so this is a prefix that was added to the canonical
-- name and never backfilled onto the requests already filed.
--
-- The target EXISTS and is ACTIVE in ONEST Marketing / Supporting Budget,
-- checked before writing and asserted below. Renaming onto a coordinate that
-- does not exist would swap one unbudgetable location for another, which is
-- the fault migration 043 was written to fix.
--
-- ===========================================================================
-- ONEST MARKETING ONLY. FOURTEEN SV REQUESTS CARRY THE SAME PAIR.
-- ===========================================================================
-- SV Marketing has its own 'Supporting Budget / ค่าเดินทาง' spend — 14
-- requests — and its own canonical 'MKT ค่าเดินทาง' category. It almost
-- certainly needs the same correction, but it was NOT part of this
-- instruction and is NOT touched here. Every statement is scoped to
-- department = 'Marketing' AND coalesce(use_for_company, bu) = 'ONEST', and
-- the verify block asserts the SV count is unchanged.
--
-- use_for_company, not bu: the company the expense is CHARGED to is what
-- scopes everything since migration 039.
--
-- HEADER AND items_json BOTH, as 043/059/061 did. v_request_spend reads the
-- ITEM's cat_l2 with the header only as a fallback, so rewriting the header
-- alone would leave the spend report unmoved.
--
-- NO MONEY MOVES. Only the category label changes.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   update requests r
--      set cat_l2 = s.cat_l2_original, items_json = s.items_json_original
--     from requests_mkt_travel_067 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_RECATEGORISED'
--     and detail_json ->> 'migration' = '067_marketing_travel_cat_l2';
-- ---------------------------------------------------------------------------

create table if not exists requests_mkt_travel_067 (
  request_id text primary key,
  cat_l1_original text,
  cat_l2_original text,
  items_json_original jsonb,
  items_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table requests_mkt_travel_067 is
  'Pre-change cat_l2 and items_json for every ONEST Marketing request renamed by migration 067. Rollback source.';

do $$
declare
  k_l1  constant text := 'Supporting Budget';
  k_old constant text := 'ค่าเดินทาง';
  k_new constant text := 'MKT ค่าเดินทาง';
  v_snapshot integer;
  v_audit integer;
  v_headers integer;
  v_items integer;
  v_sv_before integer;
  v_sv_after integer;
  v_total_before numeric;
  v_total_after numeric;
  v_left integer;
begin
  if not exists (
    select 1 from categories
     where bu = 'ONEST' and department = 'Marketing'
       and cat_l1 = k_l1 and cat_l2 = k_new and coalesce(active, true)
  ) then
    raise exception 'ABORT: ONEST Marketing / % / % is not an active category.', k_l1, k_new;
  end if;

  select count(*) into v_sv_before
    from requests r
   where coalesce(nullif(r.use_for_company, ''), r.bu) <> 'ONEST'
     and (
       (r.cat_l1 = k_l1 and r.cat_l2 = k_old)
       or (jsonb_typeof(r.items_json) = 'array'
           and exists (select 1 from jsonb_array_elements(r.items_json) x
                        where x ->> 'cat_l1' = k_l1 and x ->> 'cat_l2' = k_old))
     );
  select coalesce(sum(total), 0) into v_total_before from requests;

  insert into requests_mkt_travel_067
    (request_id, cat_l1_original, cat_l2_original, items_json_original, items_changed)
  select r.request_id, r.cat_l1, r.cat_l2, r.items_json,
    coalesce((select count(*) from jsonb_array_elements(r.items_json) x
               where jsonb_typeof(r.items_json) = 'array'
                 and x ->> 'cat_l1' = k_l1 and x ->> 'cat_l2' = k_old), 0)
  from requests r
  where r.department = 'Marketing'
    and coalesce(nullif(r.use_for_company, ''), r.bu) = 'ONEST'
    and (
      (r.cat_l1 = k_l1 and r.cat_l2 = k_old)
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x
                       where x ->> 'cat_l1' = k_l1 and x ->> 'cat_l2' = k_old))
    )
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', s.request_id, 'REQUEST_RECATEGORISED',
    jsonb_build_object(
      'field', 'cat_l2 (header and items_json)',
      'from', jsonb_build_object('cat_l1', k_l1, 'cat_l2', k_old),
      'to',   jsonb_build_object('cat_l1', k_l1, 'cat_l2', k_new),
      'items_changed', s.items_changed,
      'company', 'ONEST', 'department', 'Marketing',
      'reason', 'Old name of the same line: the canonical category gained an "MKT " prefix that was never backfilled onto requests already filed. Confirmed by the data owner.',
      'amount_unchanged', true,
      'migration', '067_marketing_travel_cat_l2',
      'rollback_source', 'requests_mkt_travel_067'
    )
  from requests_mkt_travel_067 s;
  get diagnostics v_audit = row_count;

  update requests r
     set cat_l2 = k_new, updated_at = now()
    from requests_mkt_travel_067 s
   where r.request_id = s.request_id
     and r.cat_l1 = k_l1 and r.cat_l2 = k_old;
  get diagnostics v_headers = row_count;

  -- ORDER BY ordinality preserves item order; header fields are derived from
  -- items[0] elsewhere in this app.
  update requests r
     set items_json = (
           select jsonb_agg(
                    case when t.it ->> 'cat_l1' = k_l1 and t.it ->> 'cat_l2' = k_old
                         then jsonb_set(t.it, '{cat_l2}', to_jsonb(k_new))
                         else t.it end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         ),
         updated_at = now()
    from requests_mkt_travel_067 s
   where r.request_id = s.request_id
     and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_items = row_count;

  -- ===========================================================================
  -- VERIFY OR ABORT
  -- ===========================================================================
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  select count(*) into v_sv_after
    from requests r
   where coalesce(nullif(r.use_for_company, ''), r.bu) <> 'ONEST'
     and (
       (r.cat_l1 = k_l1 and r.cat_l2 = k_old)
       or (jsonb_typeof(r.items_json) = 'array'
           and exists (select 1 from jsonb_array_elements(r.items_json) x
                        where x ->> 'cat_l1' = k_l1 and x ->> 'cat_l2' = k_old))
     );
  if v_sv_after <> v_sv_before then
    raise exception 'ABORT: non-ONEST requests carrying the old value went % -> %. SV was touched.',
      v_sv_before, v_sv_after;
  end if;

  select coalesce(sum(total), 0) into v_total_after from requests;
  if v_total_after <> v_total_before then
    raise exception 'ABORT: sum(total) moved % -> %. This is a renaming exercise.',
      v_total_before, v_total_after;
  end if;

  select count(*) into v_left
    from requests r
   where r.department = 'Marketing'
     and coalesce(nullif(r.use_for_company, ''), r.bu) = 'ONEST'
     and (
       (r.cat_l1 = k_l1 and r.cat_l2 = k_old)
       or (jsonb_typeof(r.items_json) = 'array'
           and exists (select 1 from jsonb_array_elements(r.items_json) x
                        where x ->> 'cat_l1' = k_l1 and x ->> 'cat_l2' = k_old))
     );
  if v_left > 0 then
    raise exception 'ABORT: % ONEST Marketing request(s) still carry the old value.', v_left;
  end if;

  raise notice '067: snapshot=% audit=% headers=% item-requests=% | SV untouched (% rows) | sum(total) % unchanged',
    v_snapshot, v_audit, v_headers, v_items, v_sv_after, v_total_after;
end $$;
