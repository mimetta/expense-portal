-- Reconcile Retail branch names in spend against the revenue channel list.
--
-- Same snapshot + audit + verify-or-abort pattern as migrations 019, 020, 043,
-- 051. Decisions from docs/branch-name-reconciliation.md.
--
--   'Gaysorn Amarin'     -> 'Gaysorn'           same store
--   'Dusit Central Park' -> 'DCP'               same store (D-usit C-entral P-ark)
--   'Loft Eyes'          -> 'Loft eyes'         one store, three spellings
--   'Lofteyes'           -> 'Loft eyes'
--   'All branch'         -> NULL                estate-wide cost, NOT a store
--
-- NO CHANNEL IS CREATED FOR 'All branch'. It would sit in the revenue
-- hierarchy where somebody could give it a revenue goal, and it is not a place
-- that can earn revenue — it is travel BETWEEN branches, bulk consumables and
-- uniforms. It becomes the (no branch) bucket, which exists for exactly this.
--
-- ===========================================================================
-- RETAIL ONLY. requests.product IS OVERLOADED AND THIS IS NOT COSMETIC.
-- ===========================================================================
-- That column holds a BRANCH for Retail and a PRODUCT NAME for R&D — the fault
-- migration 058 found when "Hand Cream" and "Wood Polish" appeared as stores.
-- Every statement below is scoped `department = 'Retail'`, and the verify block
-- asserts the non-Retail occurrence count is unchanged.
--
-- That assertion is not theoretical. ONE non-Retail request carries a value in
-- this map: EXP-2026-07-000043, People (HR), 'All branch', a training meal
-- reimbursement. It MUST survive untouched, and the count check is what proves
-- it did.
--
-- HEADER AND items_json BOTH, as 043 did. v_request_spend reads the ITEM's
-- product with the header only as a fallback (migration 058), so rewriting the
-- header alone would leave the spend report unmoved — the exact trap 043
-- documents.
--
-- NO MONEY MOVES. Only the branch label changes. Amounts, companies,
-- departments, statuses and dates are untouched, so FY2026 totals for ONEST,
-- SV and All are unchanged to the satang.
--
-- audit_log IS NOT REWRITTEN. This migration only INSERTS to it. The log
-- records what happened under the name in use at the time; migration 038's
-- header states the rule and it holds here.
--
-- NOT INCLUDED: 'Unusual&Friend' -> 'Unusual & Friend'. It appears in
-- docs/branch-name-reconciliation.md under RENAME but no decision was given
-- for it, so it is deliberately left alone rather than folded in. ฿228, one
-- BO_APPROVED request, item-level only.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (one statement, against the pre-image)
--
--   update requests r
--      set product = s.product_original,
--          items_json = s.items_json_original
--     from requests_branch_rename_059 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_BRANCH_RENAMED'
--     and detail_json ->> 'migration' = '059_retail_branch_name_reconciliation';
--
-- The snapshot stores the WHOLE items_json, not a diff, so the restore is one
-- assignment and cannot half-apply.
-- ---------------------------------------------------------------------------

create table if not exists requests_branch_rename_059 (
  request_id text primary key,
  product_original text,
  items_json_original jsonb,
  items_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table requests_branch_rename_059 is
  'Pre-change product and items_json for every Retail request renamed by migration 059. Rollback source.';

do $$
declare
  v_snapshot integer;
  v_audit integer;
  v_headers integer;
  v_item_reqs integer;
  v_nonretail_before integer;
  v_nonretail_after integer;
  v_total_before numeric;
  v_total_after numeric;
  v_rows_before integer;
  v_rows_after integer;
  v_left integer;
begin
  -- The map, as data, so every statement below reads one definition.
  create temporary table branch_map_059 (old_name text primary key, new_name text)
    on commit drop;
  insert into branch_map_059 values
    ('Gaysorn Amarin',     'Gaysorn'),
    ('Dusit Central Park', 'DCP'),
    ('Loft Eyes',          'Loft eyes'),
    ('Lofteyes',           'Loft eyes'),
    ('All branch',         null);        -- null = the (no branch) bucket

  -- 0. PRECONDITION. Every non-null target must be an ACTIVE channel, or this
  --    would rename spend onto a branch the budget page cannot offer — trading
  --    one mismatch for another.
  if exists (
    select 1 from branch_map_059 m
     where m.new_name is not null
       and not exists (
         select 1 from revenue_channels c
          where c.bu = 'ONEST' and c.category = 'Physical store'
            and c.channel = m.new_name and c.active
       )
  ) then
    raise exception 'ABORT: a rename target is not an active ONEST Physical store channel.';
  end if;

  -- Baselines, measured BEFORE any write, against the same live data the
  -- after-check reads.
  select count(*) into v_nonretail_before
    from requests r
   where r.department <> 'Retail'
     and (r.product in (select old_name from branch_map_059)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_059))));

  select count(*), coalesce(sum(total), 0) into v_rows_before, v_total_before
    from requests;

  -- 1. Snapshot every affected Retail request WHOLE, before any write.
  insert into requests_branch_rename_059
    (request_id, product_original, items_json_original, items_changed)
  select
    r.request_id, r.product, r.items_json,
    coalesce((
      select count(*) from jsonb_array_elements(r.items_json) x
       where jsonb_typeof(r.items_json) = 'array'
         and x ->> 'product' in (select old_name from branch_map_059)
    ), 0)
  from requests r
  where r.department = 'Retail'
    and (
      r.product in (select old_name from branch_map_059)
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x
                       where x ->> 'product' in (select old_name from branch_map_059)))
    )
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  -- 2. One audit row per request. Written BEFORE the update so the detail can
  --    read the original value from the snapshot, not from a mutated row.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', s.request_id, 'REQUEST_BRANCH_RENAMED',
    jsonb_build_object(
      'field', 'product (header and items_json)',
      'from', s.product_original,
      'to', (select m.new_name from branch_map_059 m where m.old_name = s.product_original),
      'items_changed', s.items_changed,
      'department', 'Retail',
      'reason', 'Retail branch names in spend did not match the revenue channel list, so the spend report could not be compared with the branch budget. See docs/branch-name-reconciliation.md.',
      'amount_unchanged', true,
      'migration', '059_retail_branch_name_reconciliation',
      'rollback_source', 'requests_branch_rename_059'
    )
  from requests_branch_rename_059 s;
  get diagnostics v_audit = row_count;

  -- 3a. Header. Scoped to Retail; the join to the map is what limits it to the
  --     five names.
  update requests r
     set product = m.new_name,
         updated_at = now()
    from branch_map_059 m
   where r.department = 'Retail'
     and r.product = m.old_name;
  get diagnostics v_headers = row_count;

  -- 3b. items_json. ORDER BY ordinality preserves item order — header fields
  --     are derived from items[0] elsewhere in this app.
  --
  --     'All branch' maps to SQL NULL, and to_jsonb(null::text) is JSON null,
  --     so `item ->> 'product'` reads NULL afterwards and the view's
  --     nullif(..., '') treatment is unaffected.
  update requests r
     set items_json = (
           select jsonb_agg(
                    case
                      when t.it ->> 'product' in (select old_name from branch_map_059)
                        then jsonb_set(
                               t.it, '{product}',
                               to_jsonb((select m.new_name from branch_map_059 m
                                          where m.old_name = t.it ->> 'product'))
                             )
                      else t.it
                    end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         ),
         updated_at = now()
    from requests_branch_rename_059 s
   where r.request_id = s.request_id
     and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_item_reqs = row_count;

  -- =========================================================================
  -- VERIFY OR ABORT. Any RAISE rolls the whole migration back.
  -- =========================================================================
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  -- NOT ONE NON-RETAIL ROW MAY HAVE MOVED. EXP-2026-07-000043 (People (HR),
  -- 'All branch') is the live case this protects.
  select count(*) into v_nonretail_after
    from requests r
   where r.department <> 'Retail'
     and (r.product in (select old_name from branch_map_059)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_059))));
  if v_nonretail_after <> v_nonretail_before then
    raise exception 'ABORT: non-Retail requests carrying a mapped value went % -> %. A non-Retail row was touched.',
      v_nonretail_before, v_nonretail_after;
  end if;

  -- No money moved, and no request appeared or vanished.
  select count(*), coalesce(sum(total), 0) into v_rows_after, v_total_after from requests;
  if v_rows_after <> v_rows_before then
    raise exception 'ABORT: request count went % -> %.', v_rows_before, v_rows_after;
  end if;
  if v_total_after <> v_total_before then
    raise exception 'ABORT: sum(total) moved % -> %. This is a renaming exercise.',
      v_total_before, v_total_after;
  end if;

  -- Every old name is gone from Retail, header and item alike.
  select count(*) into v_left
    from requests r
   where r.department = 'Retail'
     and (r.product in (select old_name from branch_map_059)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_059))));
  if v_left > 0 then
    raise exception 'ABORT: % Retail request(s) still carry an old branch name.', v_left;
  end if;

  raise notice '059: snapshot=% audit=% headers=% item-requests=% | non-Retail untouched (% rows) | sum(total) % unchanged',
    v_snapshot, v_audit, v_headers, v_item_reqs, v_nonretail_after, v_total_after;
end $$;
