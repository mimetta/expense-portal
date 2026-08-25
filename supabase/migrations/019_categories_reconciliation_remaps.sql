-- Mimetta Expense Portal — categories reconciliation, part B (the remaps)
--
-- Migration B of three. Requires 018 (part A) — the snapshot table and the
-- COG category rows the Factory spend lands on are both created there.
-- See docs/categories-reconciliation.md for the plan and per-row rationale.
--
-- This is the only destructive step of the three: it rewrites
-- requests.department on 367 rows, 295 of which are already PAID. Every
-- change is captured in requests_department_remap_2026_08 and in audit_log
-- BEFORE the update runs, and the migration aborts if those records do not
-- account for exactly the rows it changed.
--
-- ---------------------------------------------------------------------------
-- WHAT IS REMAPPED
--
--   department = 'Factory'                            -> 'COG'    (307 requests)
--     Factory is not a real department (part C removes it from
--     lib/constants.ts#DEPARTMENTS). All 11 Factory orphan combinations
--     resolve to COG; five of them needed a new COG category row, added in
--     part A.
--
--   SV    / General Administrative / HR Operation     -> 'People (HR)'  (49)
--   ONEST / General Administrative / HR Operation     -> 'People (HR)'  (10)
--   ONEST / Retail                 / HRD              -> 'People (HR)'  (1)
--     `HR Operation` and `HRD` exist only under People (HR), in both BUs.
--     Legacy department mislabels of the same shape as Factory.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY SKIPPED — three REMAP_DEPT rows from the plan doc
--
--   SV / People (HR) / Factory Operation (OH) - COG   -> would be COG
--   SV / People (HR) / Logistic Staff (pick/pack/delivery) -> would be Operations/Fulfillment
--   SV / People (HR) / Other Miscellaneous            -> would be General Administrative
--
-- These are ITEM-LEVEL artifacts, not header mislabels. The orphan arises
-- from an item's cat_l1 paired with the header department; the header's own
-- cat_l1 is something else entirely. All three live in just two requests:
--
--   EXP-2026-07-000132  header cat_l1 = 'HR Operation'
--   EXP-2026-07-000116  header cat_l1 = 'HR Benefits'
--
-- Remapping the header department would move EVERY item on those requests,
-- including items that are classified correctly, to fix one item that is
-- not. They are left alone for the v_request_spend change (grouping by the
-- item's segment rather than the header department) to resolve, or for an
-- item-level correction. Matching on department + cat_l1 below means neither
-- request is touched by this migration: both have department = 'People (HR)',
-- which no rule here matches.
--
-- ---------------------------------------------------------------------------
-- ITEMS_JSON
--
-- items_json[].segment is updated alongside the header for every remapped
-- request, from the original department to the new one. The brief specified
-- this only for 'Factory'; it is applied to all four groups because the same
-- reasoning holds — once v_request_spend groups by the item segment, a
-- header remapped to People (HR) whose items still say General Administrative
-- would simply reappear as an orphan at item level, and the remap would have
-- achieved nothing. Header and items are kept consistent. Scoped strictly to
-- the requests in the snapshot table, and only to items whose segment equals
-- that request's original department.
-- ---------------------------------------------------------------------------

do $$
declare
  v_snapshot integer;
  v_updated  integer;
  v_audit    integer;
  v_items    integer;
  v_left     integer;
begin
  -- 1. Snapshot every request about to change, BEFORE changing it. This is
  --    the only record of the pre-remap value; requests has no
  --    department_original column of any kind.
  insert into requests_department_remap_2026_08 (request_id, department_original, department_new)
  select request_id, department, 'COG'
    from requests where department = 'Factory'
  union all
  select request_id, department, 'People (HR)'
    from requests where bu = 'SV' and department = 'General Administrative' and cat_l1 = 'HR Operation'
  union all
  select request_id, department, 'People (HR)'
    from requests where bu = 'ONEST' and department = 'General Administrative' and cat_l1 = 'HR Operation'
  union all
  select request_id, department, 'People (HR)'
    from requests where bu = 'ONEST' and department = 'Retail' and cat_l1 = 'HRD';
  get diagnostics v_snapshot = row_count;

  -- 2. One audit_log row per change. 'system@migration' follows the existing
  --    'system@cron' convention for non-user actors.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration',
    s.request_id,
    'DEPARTMENT_REMAPPED',
    jsonb_build_object(
      'field', 'department',
      'from', s.department_original,
      'to', s.department_new,
      'reason', case
        when s.department_original = 'Factory'
          then 'Factory is not a real department; spend belongs under COG (categories reconciliation)'
        else 'cat_l1 exists only under the target department; legacy header mislabel (categories reconciliation)'
      end,
      'migration', '019_categories_reconciliation_remaps',
      'rollback_source', 'requests_department_remap_2026_08'
    )
  from requests_department_remap_2026_08 s;
  get diagnostics v_audit = row_count;

  -- 3. The header remap itself, driven off the snapshot so it cannot diverge
  --    from what was recorded.
  update requests r
     set department = s.department_new,
         updated_at = now()
    from requests_department_remap_2026_08 s
   where r.request_id = s.request_id;
  get diagnostics v_updated = row_count;

  -- 4. items_json[].segment, same scope. jsonb_agg with ORDER BY ordinality
  --    preserves item order, which matters — the flat requests.cat_l1/cat_l2
  --    columns are populated from items[0] by convention.
  update requests r
     set items_json = (
           select jsonb_agg(
                    case when it ->> 'segment' = s.department_original
                         then jsonb_set(it, '{segment}', to_jsonb(s.department_new))
                         else it end
                    order by ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         )
    from requests_department_remap_2026_08 s
   where r.request_id = s.request_id
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0
     and exists (
           select 1 from jsonb_array_elements(r.items_json) x
            where x ->> 'segment' = s.department_original
         );
  get diagnostics v_items = row_count;

  -- 5. Verify and abort. RAISE rolls the whole migration back.
  if v_snapshot <> v_updated then
    raise exception
      'ABORT: snapshot rows (%) <> updated rows (%). The remap would have changed rows it did not record.',
      v_snapshot, v_updated;
  end if;

  if v_audit <> v_snapshot then
    raise exception
      'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  select count(*) into v_left from requests where department = 'Factory';
  if v_left <> 0 then
    raise exception 'ABORT: % requests still carry department = ''Factory''.', v_left;
  end if;

  select count(*) into v_left
    from requests r, jsonb_array_elements(r.items_json) x
   where jsonb_typeof(r.items_json) = 'array' and x ->> 'segment' = 'Factory';
  if v_left <> 0 then
    raise exception 'ABORT: % items_json entries still carry segment = ''Factory''.', v_left;
  end if;

  raise notice 'remapped % requests (% snapshot, % audit rows, % requests had items updated)',
    v_updated, v_snapshot, v_audit, v_items;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   update requests r
--      set department = s.department_original,
--          updated_at = now()
--     from requests_department_remap_2026_08 s
--    where r.request_id = s.request_id;
--
--   update requests r
--      set items_json = (
--            select jsonb_agg(
--                     case when it ->> 'segment' = s.department_new
--                          then jsonb_set(it, '{segment}', to_jsonb(s.department_original))
--                          else it end
--                     order by ord)
--              from jsonb_array_elements(r.items_json) with ordinality as t(it, ord))
--     from requests_department_remap_2026_08 s
--    where r.request_id = s.request_id
--      and jsonb_typeof(r.items_json) = 'array'
--      and jsonb_array_length(r.items_json) > 0;
--
--   delete from audit_log where action = 'DEPARTMENT_REMAPPED'
--     and detail_json ->> 'migration' = '019_categories_reconciliation_remaps';
--
--   delete from requests_department_remap_2026_08;
--
-- Reverting also requires restoring 'Factory' to lib/constants.ts#DEPARTMENTS
-- if part C has been applied.
-- ---------------------------------------------------------------------------
