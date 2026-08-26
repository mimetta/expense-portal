-- Mimetta Expense Portal — categories reconciliation, final decisions
--
-- Closes out the orphan work started in 018-021. Same snapshot + audit +
-- verify-or-abort pattern as 019/020/021. Updates BOTH the flat
-- requests.department/cat_l1 columns AND the matching items_json fields,
-- because v_request_spend is being changed to read the item's segment.
--
-- 22 requests. Every affected request was verified single-item before this
-- was written, and the migration re-asserts that below rather than trusting
-- it — the item rewrite sets every item in the array, which is only correct
-- for single-item requests.
--
-- ---------------------------------------------------------------------------
-- GROUP B — typo, 2 requests, ThB 4,054
--   EXP-2026-07-000148, EXP-2026-07-000146
--   cat_l1 'Factory Operation (OH - COG' -> 'Factory Operation (OH) - COG'
--   (unbalanced parenthesis). Verified: the correct spelling exists under
--   both BUs' COG with 23 cat_l2 rows, including the exact 'Production
--   Consumable' both requests carry. No category rows needed. This also
--   restores their budget owner — siriwan.b's enumerated COG scope (migration
--   021) contains the correct spelling but not the typo.
--
-- GROUP A / Recruitment — 5 requests, ThB 23,905
--   EXP-2026-06-000083, -05-000028, -04-000066, -06-000151 (SV),
--   EXP-2026-04-000059 (ONEST)
--   department 'General Administrative' -> 'People (HR)', cat_l1
--   'People & HR & System' -> 'HR Operation'. cat_l2 left alone: verified all
--   five carry cat_l2 = 'Recruitment' on BOTH the header and the item, and
--   (bu, People (HR), HR Operation, Recruitment) exists in BOTH BUs.
--
-- GROUP A / Travel — 4 requests, ThB 12,677
--   EXP-2026-04-000011, -05-000140, -06-000112, -06-000110 (all SV)
--   department stays General Administrative; cat_l1 -> 'GA ค่าเดินทาง', a new
--   category created below in both BUs. The name follows the house pattern of
--   a per-department travel line — compare 'Retail ค่าเดินทาง' and
--   'ค่าเดินทางพนักงาน Fulfillment' — using the GA abbreviation already in
--   lib/constants.ts#DEPARTMENT_ABBREV. Both existing travel categories carry
--   cat_l2 = null, so these do too. Each request keeps its own cat_l2
--   ('ค่าเดินทาง'), which therefore has no cat_l2-level row; that matches how
--   the other two travel categories already behave.
--
-- GROUP C — null cat_l1, 11 requests, ThB 82,989
--   C1 (5, ONEST) + C2 petty cash (2, SV): cat_l1 -> 'Factory Operation (OH)
--     - COG'. All seven are explicitly factory petty cash. Department already
--     COG. cat_l2 stays null.
--   C2 NSTDA (2, SV): department COG -> 'R&D', cat_l1 -> 'Regulatory
--     Compliance'. These are royalty payments for Beauveria/Metarhizium
--     research licences — R&D, not cost of goods.
--   C3 (1, SV): cat_l1 -> 'HRD' (travel for AI training, 4 people).
--     Department already People (HR).
--   C4 (1, SV): cat_l1 -> 'Other Miscellaneous' (Chinese New Year shrine
--     offerings). Department already General Administrative.
--
-- ---------------------------------------------------------------------------
-- GROUP D — NO ACTION, deliberately.
--
--   EXP-2026-07-000132  header People (HR); items [HR Operation x3,
--                       COG/Factory Operation (OH) - COG]
--   EXP-2026-07-000116  header People (HR); items [HR Benefits,
--                       Operations/Fulfillment/Logistic Staff, GA/Other
--                       Miscellaneous]
--
-- These are correctly-classified MULTI-SEGMENT requests. They appear as
-- orphans only because the flat header column cannot represent a request
-- spanning several segments, and today's v_request_spend pairs each item's
-- cat_l1 with the header department. Every one of their items already maps to
-- a real categories row under its own segment (verified), so the view change
-- resolves them with no data change. Remapping their headers would
-- misattribute the items that are already right — which is why migration 019
-- excluded them too.
--
-- ---------------------------------------------------------------------------
-- ALSO NOT TOUCHED, reported instead: EXP-2026-06-000043 (ONEST, ThB 1,585,
-- 'ค่าเดินทางไปAmpack', cat_l2 'BB ค่าเดินทาง'). "BB" reads as Brand Building,
-- which would put it under Marketing rather than GA travel, but the evidence
-- is genuinely split: 'BB ค่าเดินทาง' exists nowhere in categories, no cat_l2
-- anywhere else starts with 'BB ', ONEST Brand Building has no travel cat_l2,
-- the requester has no roles row and has filed exactly this one request ever.
-- Left as an orphan pending a human call rather than guessed at.
-- ---------------------------------------------------------------------------

-- New GA travel category, both BUs. categories has no unique constraint, so
-- guarded with NOT EXISTS (same as migration 018).
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'General Administrative', 'GA ค่าเดินทาง', null
where not exists (select 1 from categories where bu = 'SV' and department = 'General Administrative'
  and cat_l1 = 'GA ค่าเดินทาง' and cat_l2 is null);

insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'General Administrative', 'GA ค่าเดินทาง', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'General Administrative'
  and cat_l1 = 'GA ค่าเดินทาง' and cat_l2 is null);

create table if not exists requests_reconciliation_2026_08 (
  request_id           text primary key references requests (request_id) on delete cascade,
  decision_group       text not null,
  department_original  text not null,
  department_new       text not null,
  cat_l1_original      text,
  cat_l1_new           text not null,
  items_json_original  jsonb not null,
  changed_at           timestamptz not null default now()
);

comment on table requests_reconciliation_2026_08 is
  'Pre-change department/cat_l1/items_json for every request touched by migration 022 (final categories reconciliation). Rollback source.';

alter table requests_reconciliation_2026_08 enable row level security;
grant all on requests_reconciliation_2026_08 to service_role;

do $$
declare
  v_snapshot integer;
  v_updated  integer;
  v_audit    integer;
  v_bad      integer;
begin
  -- 1. Snapshot before touching anything.
  insert into requests_reconciliation_2026_08
    (request_id, decision_group, department_original, department_new, cat_l1_original, cat_l1_new, items_json_original)
  select r.request_id, v.grp, r.department, v.new_dept, r.cat_l1, v.new_l1, r.items_json
    from requests r
    join (values
      -- GROUP B — typo
      ('EXP-2026-07-000148', 'B',  'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-07-000146', 'B',  'COG',                    'Factory Operation (OH) - COG'),
      -- GROUP A / Recruitment
      ('EXP-2026-06-000083', 'A1', 'People (HR)',            'HR Operation'),
      ('EXP-2026-05-000028', 'A1', 'People (HR)',            'HR Operation'),
      ('EXP-2026-04-000066', 'A1', 'People (HR)',            'HR Operation'),
      ('EXP-2026-06-000151', 'A1', 'People (HR)',            'HR Operation'),
      ('EXP-2026-04-000059', 'A1', 'People (HR)',            'HR Operation'),
      -- GROUP A / Travel
      ('EXP-2026-04-000011', 'A2', 'General Administrative', 'GA ค่าเดินทาง'),
      ('EXP-2026-05-000140', 'A2', 'General Administrative', 'GA ค่าเดินทาง'),
      ('EXP-2026-06-000112', 'A2', 'General Administrative', 'GA ค่าเดินทาง'),
      ('EXP-2026-06-000110', 'A2', 'General Administrative', 'GA ค่าเดินทาง'),
      -- GROUP C1 + C2 petty cash
      ('EXP-2026-02-000044', 'C1', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-02-000132', 'C1', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-03-000057', 'C1', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-03-000153', 'C1', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-04-000031', 'C1', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-02-000037', 'C2', 'COG',                    'Factory Operation (OH) - COG'),
      ('EXP-2026-02-000084', 'C2', 'COG',                    'Factory Operation (OH) - COG'),
      -- GROUP C2 NSTDA
      ('EXP-2026-02-000076', 'C2', 'R&D',                    'Regulatory Compliance'),
      ('EXP-2026-02-000075', 'C2', 'R&D',                    'Regulatory Compliance'),
      -- GROUP C3 / C4
      ('EXP-2026-02-000082', 'C3', 'People (HR)',            'HRD'),
      ('EXP-2026-02-000095', 'C4', 'General Administrative', 'Other Miscellaneous')
    ) as v(rid, grp, new_dept, new_l1) on v.rid = r.request_id;
  get diagnostics v_snapshot = row_count;

  if v_snapshot <> 22 then
    raise exception 'ABORT: expected 22 requests, snapshotted %.', v_snapshot;
  end if;

  -- The item rewrite below sets EVERY item in the array, which is only valid
  -- for single-item requests. Assert that rather than assume it.
  select count(*) into v_bad
    from requests r
    join requests_reconciliation_2026_08 s on s.request_id = r.request_id
   where jsonb_typeof(r.items_json) <> 'array' or jsonb_array_length(r.items_json) <> 1;
  if v_bad <> 0 then
    raise exception 'ABORT: % affected request(s) are not single-item; the item rewrite would clobber correctly-classified items.', v_bad;
  end if;

  -- 2. One audit row per request.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration',
    s.request_id,
    'RECONCILIATION_RECLASSIFIED',
    jsonb_build_object(
      'decision_group', s.decision_group,
      'department_from', s.department_original,
      'department_to', s.department_new,
      'cat_l1_from', s.cat_l1_original,
      'cat_l1_to', s.cat_l1_new,
      'also_updated', 'items_json[0].segment, items_json[0].cat_l1',
      'reason', 'categories reconciliation final decisions; see docs/categories-reconciliation.md',
      'migration', '022_reconciliation_final',
      'rollback_source', 'requests_reconciliation_2026_08'
    )
  from requests_reconciliation_2026_08 s;
  get diagnostics v_audit = row_count;

  -- 3. Header columns.
  update requests r
     set department = s.department_new,
         cat_l1     = s.cat_l1_new,
         updated_at = now()
    from requests_reconciliation_2026_08 s
   where r.request_id = s.request_id;
  get diagnostics v_updated = row_count;

  -- 4. items_json — segment and cat_l1 on every item (all single-item, as
  --    asserted above). cat_l2 is deliberately untouched throughout.
  update requests r
     set items_json = (
           select jsonb_agg(
                    jsonb_set(
                      jsonb_set(t.it, '{segment}', to_jsonb(s.department_new)),
                      '{cat_l1}', to_jsonb(s.cat_l1_new)
                    )
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         )
    from requests_reconciliation_2026_08 s
   where r.request_id = s.request_id;

  -- 5. Verify or abort.
  if v_snapshot <> v_updated then
    raise exception 'ABORT: snapshot rows (%) <> updated rows (%).', v_snapshot, v_updated;
  end if;
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  -- No touched request may disagree between its header and its item.
  select count(*) into v_bad
    from requests r
    join requests_reconciliation_2026_08 s on s.request_id = r.request_id,
         jsonb_array_elements(r.items_json) x
   where x ->> 'segment' is distinct from r.department
      or x ->> 'cat_l1'  is distinct from r.cat_l1;
  if v_bad <> 0 then
    raise exception 'ABORT: % item(s) disagree with their header after the update.', v_bad;
  end if;

  -- The typo must be gone everywhere, header and item alike.
  select count(*) into v_bad
    from requests r
   where r.cat_l1 = 'Factory Operation (OH - COG'
      or exists (select 1 from jsonb_array_elements(r.items_json) x
                  where x ->> 'cat_l1' = 'Factory Operation (OH - COG');
  if v_bad <> 0 then
    raise exception 'ABORT: % request(s) still carry the malformed cat_l1.', v_bad;
  end if;

  raise notice 'reclassified % requests (% snapshot, % audit)', v_updated, v_snapshot, v_audit;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   update requests r
--      set department = s.department_original,
--          cat_l1     = s.cat_l1_original,
--          items_json = s.items_json_original,
--          updated_at = now()
--     from requests_reconciliation_2026_08 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'RECONCILIATION_RECLASSIFIED'
--     and detail_json ->> 'migration' = '022_reconciliation_final';
--
--   delete from requests_reconciliation_2026_08;
--
--   delete from categories
--    where cat_l1 = 'GA ค่าเดินทาง' and department = 'General Administrative';
--
-- items_json is restored from the whole-array snapshot, so no per-item
-- reassembly is needed.
-- ---------------------------------------------------------------------------
