-- The two Retail branch names left unreconciled by migration 059.
--
-- Same snapshot + audit + verify-or-abort pattern as 019, 020, 043, 051, 059.
--
--   'Nextopia (Ecotopia)' -> 'Ecotopia'           the parenthetical names it
--   'Unusual&Friend'      -> 'Unusual & Friend'   spacing around the ampersand
--
-- 059 applied the decided renames and deliberately left these two, because
-- neither was in that decision list. They are decided now.
--
-- ===========================================================================
-- RETAIL ONLY, AND ONE NON-RETAIL ROW DEPENDS ON THAT.
-- ===========================================================================
-- requests.product is overloaded: a BRANCH for Retail, a PRODUCT NAME for R&D
-- (the fault migration 058 found). EXP-2026-09-000172 is an R&D request whose
-- items_json carries product = 'Unusual&Friend' — a product, not a store. It
-- MUST survive untouched. Every statement is scoped `department = 'Retail'`,
-- and the verify block counts non-Retail occurrences before and after.
--
-- HEADER AND items_json BOTH, as 043 and 059 did. v_request_spend reads the
-- ITEM's product with the header only as a fallback, so rewriting the header
-- alone would leave the spend report unmoved.
--
-- WHAT MOVES. 'Nextopia (Ecotopia)' is one PAID request (EXP-2026-03-000117,
-- ฿483.80), header and item. 'Unusual&Friend' is one BO_APPROVED request
-- (EXP-2026-10-000008, ฿228), item only — it is below the approved basis, so
-- the spend report will not show the change until that request is approved.
--
-- NO MONEY MOVES. Only the branch label changes, so FY2026 totals for ONEST,
-- SV and All are unchanged to the satang.
--
-- audit_log is only INSERTed to, never rewritten — migration 038's rule.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (one statement, against the pre-image)
--
--   update requests r
--      set product = s.product_original,
--          items_json = s.items_json_original
--     from requests_branch_rename_061 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_BRANCH_RENAMED'
--     and detail_json ->> 'migration' = '061_retail_branch_reconciliation_remainder';
--
-- The snapshot stores the WHOLE items_json, so the restore is one assignment
-- and cannot half-apply.
-- ---------------------------------------------------------------------------

create table if not exists requests_branch_rename_061 (
  request_id text primary key,
  product_original text,
  items_json_original jsonb,
  items_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table requests_branch_rename_061 is
  'Pre-change product and items_json for every Retail request renamed by migration 061. Rollback source.';

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
  create temporary table branch_map_061 (old_name text primary key, new_name text)
    on commit drop;
  insert into branch_map_061 values
    ('Nextopia (Ecotopia)', 'Ecotopia'),
    ('Unusual&Friend',      'Unusual & Friend');

  -- 0. PRECONDITION. Both targets must be ACTIVE channels, or this renames
  --    spend onto a branch the budget page cannot offer.
  if exists (
    select 1 from branch_map_061 m
     where not exists (
       select 1 from revenue_channels c
        where c.bu = 'ONEST' and c.category = 'Physical store'
          and c.channel = m.new_name and c.active
     )
  ) then
    raise exception 'ABORT: a rename target is not an active ONEST Physical store channel.';
  end if;

  select count(*) into v_nonretail_before
    from requests r
   where r.department <> 'Retail'
     and (r.product in (select old_name from branch_map_061)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_061))));

  select count(*), coalesce(sum(total), 0) into v_rows_before, v_total_before from requests;

  -- 1. Snapshot every affected Retail request WHOLE, before any write.
  insert into requests_branch_rename_061
    (request_id, product_original, items_json_original, items_changed)
  select
    r.request_id, r.product, r.items_json,
    coalesce((
      select count(*) from jsonb_array_elements(r.items_json) x
       where jsonb_typeof(r.items_json) = 'array'
         and x ->> 'product' in (select old_name from branch_map_061)
    ), 0)
  from requests r
  where r.department = 'Retail'
    and (
      r.product in (select old_name from branch_map_061)
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x
                       where x ->> 'product' in (select old_name from branch_map_061)))
    )
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  -- 2. Audit, written BEFORE the update so the detail reads the original.
  --    The header may be null (item-only requests), so the recorded 'from'
  --    falls back to the item value actually being replaced.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', s.request_id, 'REQUEST_BRANCH_RENAMED',
    jsonb_build_object(
      'field', 'product (header and items_json)',
      'from', coalesce(
        s.product_original,
        (select x ->> 'product' from jsonb_array_elements(s.items_json_original) x
          where x ->> 'product' in (select old_name from branch_map_061) limit 1)
      ),
      'to', (select m.new_name from branch_map_061 m
              where m.old_name = coalesce(
                s.product_original,
                (select x ->> 'product' from jsonb_array_elements(s.items_json_original) x
                  where x ->> 'product' in (select old_name from branch_map_061) limit 1))),
      'items_changed', s.items_changed,
      'department', 'Retail',
      'reason', 'Remaining Retail branch names from docs/branch-name-reconciliation.md, deferred by migration 059 pending a decision.',
      'amount_unchanged', true,
      'migration', '061_retail_branch_reconciliation_remainder',
      'rollback_source', 'requests_branch_rename_061'
    )
  from requests_branch_rename_061 s;
  get diagnostics v_audit = row_count;

  -- 3a. Header.
  update requests r
     set product = m.new_name, updated_at = now()
    from branch_map_061 m
   where r.department = 'Retail' and r.product = m.old_name;
  get diagnostics v_headers = row_count;

  -- 3b. items_json. ORDER BY ordinality preserves item order — header fields
  --     are derived from items[0] elsewhere in this app.
  update requests r
     set items_json = (
           select jsonb_agg(
                    case
                      when t.it ->> 'product' in (select old_name from branch_map_061)
                        then jsonb_set(
                               t.it, '{product}',
                               to_jsonb((select m.new_name from branch_map_061 m
                                          where m.old_name = t.it ->> 'product'))
                             )
                      else t.it
                    end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         ),
         updated_at = now()
    from requests_branch_rename_061 s
   where r.request_id = s.request_id
     and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_item_reqs = row_count;

  -- =========================================================================
  -- VERIFY OR ABORT.
  -- =========================================================================
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  -- EXP-2026-09-000172 (R&D, item product 'Unusual&Friend') must not move.
  select count(*) into v_nonretail_after
    from requests r
   where r.department <> 'Retail'
     and (r.product in (select old_name from branch_map_061)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_061))));
  if v_nonretail_after <> v_nonretail_before then
    raise exception 'ABORT: non-Retail requests carrying a mapped value went % -> %. A non-Retail row was touched.',
      v_nonretail_before, v_nonretail_after;
  end if;

  select count(*), coalesce(sum(total), 0) into v_rows_after, v_total_after from requests;
  if v_rows_after <> v_rows_before then
    raise exception 'ABORT: request count went % -> %.', v_rows_before, v_rows_after;
  end if;
  if v_total_after <> v_total_before then
    raise exception 'ABORT: sum(total) moved % -> %. This is a renaming exercise.',
      v_total_before, v_total_after;
  end if;

  select count(*) into v_left
    from requests r
   where r.department = 'Retail'
     and (r.product in (select old_name from branch_map_061)
          or (jsonb_typeof(r.items_json) = 'array'
              and exists (select 1 from jsonb_array_elements(r.items_json) x
                           where x ->> 'product' in (select old_name from branch_map_061))));
  if v_left > 0 then
    raise exception 'ABORT: % Retail request(s) still carry an old branch name.', v_left;
  end if;

  raise notice '061: snapshot=% audit=% headers=% item-requests=% | non-Retail untouched (%) | sum(total) % unchanged',
    v_snapshot, v_audit, v_headers, v_item_reqs, v_nonretail_after, v_total_after;
end $$;
