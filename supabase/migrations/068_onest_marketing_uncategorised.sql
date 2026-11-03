-- Give the uncategorised ONEST Marketing lines a real category.
--
-- Snapshot + audit + verify-or-abort, as 043, 051, 059, 061, 067.
--
--   A  Brand Building / cat_l2 IS NULL -> Brand Building    / Event (Offline Campaign)   7 lines
--   B  Brand Building / cat_l2 = ''    -> Supporting Budget / MKT ค่าเดินทาง            15 lines
--   C  CRM & Retention / cat_l2 = ''   -> CRM & Retention   / CRM Promotion support      1 line
--   D  Supporting Budget / cat_l2 IS NULL -> Supporting Budget / MKT ค่าเดินทาง          1 line
--   E  Supporting Budget / cat_l2 = '' -> Brand Building    / Sponsor (brand)            1 line
--   F  EXP-2026-09-000172 item#5 -> Brand Building / Marketing Influencer / KOL          1 line
--   G  EXP-2026-10-000078 item#1 -> Brand Building / PR / Media Exposure / Gifting       1 line
--
-- ===========================================================================
-- 'NULL' AND '' ARE DIFFERENT SOURCES WITH DIFFERENT DESTINATIONS.
-- ===========================================================================
-- D and E share a cat_l1 and differ ONLY by cat_l2 IS NULL vs cat_l2 = '',
-- and they go to different places. There is deliberately NO nullif() and NO
-- coalesce() anywhere in the matching below: `it ->> 'cat_l2' IS NULL` and
-- `it ->> 'cat_l2' = ''` are written as separate predicates, and the plan
-- asserts D = 1 and E = 1 before any write. If a future edit collapses them,
-- that assertion is what fails.
--
-- (`->>` returns SQL NULL both for an absent key and for a JSON null, which
-- is the intended reading of "no cat_l2 was ever written".)
--
-- ===========================================================================
-- WHY F AND G ARE MATCHED BY REQUEST ID AND ORDINAL, NOT BY CATEGORY.
-- ===========================================================================
-- Both sit on ONEST **R&D** requests. They surface in the spend report under
-- Marketing because v_request_spend (migration 065) reads
--
--     coalesce(nullif(e.item ->> 'segment', ''), e.hdr_department)
--     coalesce(nullif(e.item ->> 'cat_l2',  ''), e.hdr_cat_l2)
--
-- so the item's own segment = 'Marketing' decides the department, while its
-- blank cat_l2 INHERITS the R&D header's. The cat_l2 values these two lines
-- appear to hold are their R&D headers' and are stored nowhere.
--
-- They are therefore addressed as two named (request_id, ordinal) pairs. The
-- scope predicate is NOT widened to item-level segment: doing that would pull
-- in every other department's Marketing-segment lines. Neither request's
-- header, department, nor any sibling item is touched.
--
-- ===========================================================================
-- REJECTED REQUESTS STAY FROZEN.
-- ===========================================================================
-- A standing rule, applied to all of A-E, not a carve-out for one row.
-- EXP-2026-06-000127 (REJECTED, ฿60,000) matches group A's predicate exactly
-- and is excluded; the verify block asserts it is byte-identical afterwards.
--
-- ===========================================================================
-- B TAKES 15 LINES, NOT 19.
-- ===========================================================================
-- 19 stored lines carry Brand Building / ''. Four of them, in two requests,
-- sit under a request header whose cat_l2 is 'Content Production', so the
-- view has always displayed them as Content Production and nobody has read
-- them as uncategorised. Only lines whose request header is ALSO blank are in
-- scope. Asserted as exactly 15 lines in exactly 3 requests, and the other 4
-- are asserted byte-identical afterwards.
--
-- ===========================================================================
-- ONEST ONLY. 14 SV MARKETING REQUESTS CARRY THE ค่าเดินทาง PATTERN 067 LEFT.
-- ===========================================================================
-- Every A-E statement is scoped `use_for_company = 'ONEST' AND department =
-- 'Marketing'`, and the verify block asserts those 14 still hold their
-- original cat_l1/cat_l2.
--
-- NO MONEY MOVES. Only category labels change.
-- audit_log is INSERTED to, never rewritten (migration 038's rule).
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   update requests r
--      set cat_l1 = s.cat_l1_original,
--          cat_l2 = s.cat_l2_original,
--          items_json = s.items_json_original
--     from _bk_068_marketing_uncat s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_RECATEGORISED'
--     and detail_json ->> 'migration' = '068_onest_marketing_uncategorised';
--
-- The snapshot holds whole rows, so the restore cannot half-apply. Do not
-- drop _bk_068_marketing_uncat.
-- ---------------------------------------------------------------------------

create table if not exists _bk_068_marketing_uncat (
  request_id text primary key,
  cat_l1_original text,
  cat_l2_original text,
  items_json_original jsonb,
  groups text,
  lines_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table _bk_068_marketing_uncat is
  'Pre-change header categories and items_json for every request touched by migration 068. Rollback source.';

do $$
declare
  -- fiscal year, the same expression v_request_spend uses
  v_on_n_b int; v_on_s_b numeric; v_sv_n_b int; v_sv_s_b numeric; v_al_n_b int; v_al_s_b numeric;
  v_on_n_a int; v_on_s_a numeric; v_sv_n_a int; v_sv_s_a numeric; v_al_n_a int; v_al_s_a numeric;
  v_mk_b numeric; v_rd_b numeric; v_mk_a numeric; v_rd_a numeric;
  v_nonon_b int; v_nonon_a int;
  v_sv_travel_b jsonb; v_sv_travel_a jsonb;
  v_frozen_b jsonb; v_frozen_a jsonb;
  v_dest_b jsonb; v_dest_a jsonb;
  v_n int; v_reqs int; v_snapshot int; v_audit int; v_headers int; v_items int;
  v_f_ok boolean; v_g_ok boolean;
  v_left int;
  -- NOT named `r`: PL/pgSQL would resolve `r.request_id` inside every SQL
  -- statement below to this record variable instead of the `requests r`
  -- table alias, and fail with 55000 before touching a row.
  rec record;
begin
  -- =========================================================================
  -- 0. THE PLAN. Built read-only and asserted before a single row is written.
  -- =========================================================================
  create temporary table plan_068 (
    request_id text not null,
    ord integer not null,              -- 1-based, from WITH ORDINALITY
    grp text not null,
    old_l1 text,
    old_l2_kind text not null,         -- 'null' | 'empty'
    old_l2 text,
    new_l1 text not null,
    new_l2 text not null,
    primary key (request_id, ord)
  ) on commit drop;

  -- A-E, by category predicate, inside the scope.
  insert into plan_068 (request_id, ord, grp, old_l1, old_l2_kind, old_l2, new_l1, new_l2)
  select r.request_id, t.ord, g.grp, t.it ->> 'cat_l1',
         case when g.src_l2_null then 'null' else 'empty' end,
         t.it ->> 'cat_l2', g.new_l1, g.new_l2
  from requests r
  cross join lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
  join (values
    ('A', 'Brand Building',    true,  false, 'Brand Building',    'Event (Offline Campaign)'),
    ('B', 'Brand Building',    false, true,  'Supporting Budget', 'MKT ค่าเดินทาง'),
    ('C', 'CRM & Retention',   false, false, 'CRM & Retention',   'CRM Promotion support'),
    ('D', 'Supporting Budget', true,  false, 'Supporting Budget', 'MKT ค่าเดินทาง'),
    ('E', 'Supporting Budget', false, false, 'Brand Building',    'Sponsor (brand)')
  ) as g(grp, src_l1, src_l2_null, needs_blank_header, new_l1, new_l2)
    on t.it ->> 'cat_l1' = g.src_l1
   and (
        (g.src_l2_null       and t.it ->> 'cat_l2' is null)
     or (not g.src_l2_null   and t.it ->> 'cat_l2' = '')
       )
   and (not g.needs_blank_header or r.cat_l2 is null or r.cat_l2 = '')
  where r.use_for_company = 'ONEST'
    and r.department = 'Marketing'
    and r.status <> 'REJECTED'          -- rejected requests stay frozen
    and jsonb_typeof(r.items_json) = 'array';

  -- F and G, by name. Ordinal is 1-based, so item#5 -> 6 and item#1 -> 2.
  insert into plan_068 (request_id, ord, grp, old_l1, old_l2_kind, old_l2, new_l1, new_l2)
  values
    ('EXP-2026-09-000172', 6, 'F', 'Marketing Influencer/KOLs', 'empty', '',
       'Brand Building', 'Marketing Influencer / KOL'),
    ('EXP-2026-10-000078', 2, 'G', 'Brand Building',            'empty', '',
       'Brand Building', 'PR / Media Exposure / Gifting');

  -- ---- plan assertions -------------------------------------------------
  for rec in select grp, count(*) n, count(distinct request_id) reqs
               from plan_068 group by grp order by grp loop
    raise notice '068 plan  %: % line(s) in % request(s)', rec.grp, rec.n, rec.reqs;
  end loop;

  select count(*) into v_n from plan_068 where grp = 'A';
  if v_n <> 7 then raise exception 'ABORT: group A = % lines, expected 7.', v_n; end if;
  select count(*), count(distinct request_id) into v_n, v_reqs from plan_068 where grp = 'B';
  if v_n <> 15 or v_reqs <> 3 then
    raise exception 'ABORT: group B = % lines in % requests, expected 15 in 3.', v_n, v_reqs;
  end if;
  select count(*) into v_n from plan_068 where grp = 'C';
  if v_n <> 1 then raise exception 'ABORT: group C = % lines, expected 1.', v_n; end if;
  select count(*) into v_n from plan_068 where grp = 'D';
  if v_n <> 1 then raise exception 'ABORT: group D = % lines, expected 1. NULL and '''' have collapsed.', v_n; end if;
  select count(*) into v_n from plan_068 where grp = 'E';
  if v_n <> 1 then raise exception 'ABORT: group E = % lines, expected 1. NULL and '''' have collapsed.', v_n; end if;

  -- One request must not appear in two groups, or the header rewrite below
  -- would have two candidate destinations.
  if exists (select 1 from plan_068 group by request_id having count(distinct grp) > 1) then
    raise exception 'ABORT: a request falls in more than one group.';
  end if;

  -- F and G must be exactly where they are claimed to be, segment included.
  select (t.it ->> 'cat_l1' = 'Marketing Influencer/KOLs'
          and t.it ->> 'cat_l2' = '' and t.it ->> 'segment' = 'Marketing')
    into v_f_ok
    from requests r
    cross join lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
   where r.request_id = 'EXP-2026-09-000172' and t.ord = 6;
  select (t.it ->> 'cat_l1' = 'Brand Building'
          and t.it ->> 'cat_l2' = '' and t.it ->> 'segment' = 'Marketing')
    into v_g_ok
    from requests r
    cross join lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
   where r.request_id = 'EXP-2026-10-000078' and t.ord = 2;
  if v_f_ok is not true then
    raise exception 'ABORT: EXP-2026-09-000172 item#5 is not the expected row.';
  end if;
  if v_g_ok is not true then
    raise exception 'ABORT: EXP-2026-10-000078 item#1 is not the expected row.';
  end if;

  -- Every destination must already exist and be active. Create nothing.
  for rec in select distinct new_l1, new_l2 from plan_068 loop
    if not exists (
      select 1 from categories c
       where c.bu = 'ONEST' and c.department = 'Marketing'
         and c.cat_l1 = rec.new_l1 and c.cat_l2 = rec.new_l2
         and coalesce(c.active, true)
    ) then
      raise exception 'ABORT: destination % / % is not an active ONEST Marketing category.',
        rec.new_l1, rec.new_l2;
    end if;
    raise notice '068 dest  ok: % [%] / % [%]',
      rec.new_l1, length(rec.new_l1), rec.new_l2, length(rec.new_l2);
  end loop;

  -- =========================================================================
  -- 1. BASELINES. Read now, compared to the same query after the write, in
  --    this one run. No figure from any earlier report is used.
  -- =========================================================================
  create temporary view fy_requests as
    select r.*,
           extract(year from coalesce(
             to_date(nullif(r.budget_period, ''), 'YYYY-MM'), r."timestamp"))::int as fyear
      from requests r;

  select count(*), coalesce(sum(total), 0) into v_on_n_b, v_on_s_b from fy_requests
   where use_for_company = 'ONEST' and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select count(*), coalesce(sum(total), 0) into v_sv_n_b, v_sv_s_b from fy_requests
   where use_for_company = 'SV'    and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select count(*), coalesce(sum(total), 0) into v_al_n_b, v_al_s_b from fy_requests
   where fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select coalesce(sum(total), 0) into v_mk_b from fy_requests
   where department = 'Marketing' and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select coalesce(sum(total), 0) into v_rd_b from fy_requests
   where department = 'R&D'       and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');

  select count(*) into v_nonon_b from requests
   where department = 'Marketing' and use_for_company <> 'ONEST';

  -- the 14 SV requests migration 067 left alone
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_sv_travel_b
    from (select jsonb_build_object('id', r.request_id, 'l1', r.cat_l1, 'l2', r.cat_l2,
                                    'items', r.items_json) as x
            from requests r
           where r.use_for_company <> 'ONEST'
             and (
               (r.cat_l1 = 'Supporting Budget' and r.cat_l2 = 'ค่าเดินทาง')
               or (jsonb_typeof(r.items_json) = 'array' and exists (
                     select 1 from jsonb_array_elements(r.items_json) e
                      where e ->> 'cat_l1' = 'Supporting Budget'
                        and e ->> 'cat_l2' = 'ค่าเดินทาง'))
             )) s;

  -- the rows that must NOT move: A's rejected line, B's 4 excluded lines
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_frozen_b
    from (select jsonb_build_object('id', r.request_id, 'items', r.items_json,
                                    'l1', r.cat_l1, 'l2', r.cat_l2) as x
            from requests r
           where r.request_id in
             ('EXP-2026-06-000127', 'EXP-2026-09-000074', 'EXP-2026-10-000112')) s;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_dest_b from (
    select d.new_l1 || ' | ' || d.new_l2 as k, count(*) as n
      from (select distinct new_l1, new_l2 from plan_068) d
      join requests r on jsonb_typeof(r.items_json) = 'array'
      cross join lateral jsonb_array_elements(r.items_json) e
     where e ->> 'cat_l1' = d.new_l1 and e ->> 'cat_l2' = d.new_l2
     group by 1) z;

  -- =========================================================================
  -- 2. SNAPSHOT, whole rows, before any write.
  -- =========================================================================
  insert into _bk_068_marketing_uncat
    (request_id, cat_l1_original, cat_l2_original, items_json_original, groups, lines_changed)
  select r.request_id, r.cat_l1, r.cat_l2, r.items_json,
         (select string_agg(distinct p2.grp, ',' order by p2.grp)
            from plan_068 p2 where p2.request_id = r.request_id),
         (select count(*) from plan_068 p3 where p3.request_id = r.request_id)
    from requests r
   where r.request_id in (select distinct request_id from plan_068)
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  -- =========================================================================
  -- 3. AUDIT, one row per request, written from the snapshot before mutation.
  --    '' and NULL are distinguishable via old_cat_l2_kind.
  -- =========================================================================
  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', s.request_id, 'REQUEST_RECATEGORISED',
    jsonb_build_object(
      'groups', s.groups,
      'lines_changed', s.lines_changed,
      'header_before', jsonb_build_object(
        'cat_l1', s.cat_l1_original,
        'cat_l2', s.cat_l2_original,
        'cat_l2_kind', case when s.cat_l2_original is null then 'null'
                            when s.cat_l2_original = ''    then 'empty'
                            else 'value' end),
      'lines', (select jsonb_agg(jsonb_build_object(
                    'group', p.grp, 'item_ordinal', p.ord,
                    'old_cat_l1', p.old_l1,
                    'old_cat_l2', p.old_l2,
                    'old_cat_l2_kind', p.old_l2_kind,
                    'new_cat_l1', p.new_l1, 'new_cat_l2', p.new_l2) order by p.ord)
                  from plan_068 p where p.request_id = s.request_id),
      'header_rewritten', (s.groups in ('A','B','C','D','E')),
      'reason', 'Line had no usable cat_l2 (NULL or empty string) and so could not be budgeted against. Destinations confirmed by the data owner; F and G additionally had a cat_l1 value that belongs one level down.',
      'amount_unchanged', true,
      'migration', '068_onest_marketing_uncategorised',
      'rollback_source', '_bk_068_marketing_uncat'
    )
  from _bk_068_marketing_uncat s
  where s.request_id in (select distinct request_id from plan_068);
  get diagnostics v_audit = row_count;

  -- =========================================================================
  -- 4a. HEADER. Groups A-E only — F and G sit on R&D requests whose headers
  --     are explicitly out of scope. Matched on the header's OWN old values,
  --     so a header that does not mirror its items is left alone.
  -- =========================================================================
  update requests r
     set cat_l1 = h.new_l1, cat_l2 = h.new_l2, updated_at = now()
    from (select distinct p.request_id, p.old_l1, p.old_l2_kind, p.new_l1, p.new_l2
            from plan_068 p where p.grp in ('A','B','C','D','E')) h
   where r.request_id = h.request_id
     and r.cat_l1 = h.old_l1
     and (   (h.old_l2_kind = 'null'  and r.cat_l2 is null)
          or (h.old_l2_kind = 'empty' and r.cat_l2 = ''));
  get diagnostics v_headers = row_count;

  -- =========================================================================
  -- 4b. items_json. The LEFT JOIN on (request_id, ord) is what makes this
  --     surgical: a plan row rewrites exactly that element, every other
  --     element passes through untouched, and ORDER BY t.ord reproduces the
  --     array in its original order.
  -- =========================================================================
  update requests r
     set items_json = (
           select jsonb_agg(
                    case when p.request_id is not null
                         then jsonb_set(
                                jsonb_set(t.it, '{cat_l1}', to_jsonb(p.new_l1)),
                                '{cat_l2}', to_jsonb(p.new_l2))
                         else t.it end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
             left join plan_068 p
                    on p.request_id = r.request_id and p.ord = t.ord
         ),
         updated_at = now()
   where r.request_id in (select distinct request_id from plan_068)
     and jsonb_typeof(r.items_json) = 'array';
  get diagnostics v_items = row_count;

  -- =========================================================================
  -- 5. VERIFY OR ABORT. Every RAISE rolls the whole migration back; there is
  --    no partial commit. Each figure is re-read now, in this same run.
  -- =========================================================================
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  -- 5a. FY2026 approved basis: ONEST, SV, All.
  select count(*), coalesce(sum(total), 0) into v_on_n_a, v_on_s_a from fy_requests
   where use_for_company = 'ONEST' and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select count(*), coalesce(sum(total), 0) into v_sv_n_a, v_sv_s_a from fy_requests
   where use_for_company = 'SV'    and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select count(*), coalesce(sum(total), 0) into v_al_n_a, v_al_s_a from fy_requests
   where fyear = 2026 and status in ('CEO_APPROVED', 'PAID');

  raise notice '068 FY2026 approved  ONEST % / %  ->  % / %', v_on_n_b, v_on_s_b, v_on_n_a, v_on_s_a;
  raise notice '068 FY2026 approved  SV    % / %  ->  % / %', v_sv_n_b, v_sv_s_b, v_sv_n_a, v_sv_s_a;
  raise notice '068 FY2026 approved  All   % / %  ->  % / %', v_al_n_b, v_al_s_b, v_al_n_a, v_al_s_a;

  if v_on_n_a <> v_on_n_b or v_on_s_a <> v_on_s_b then
    raise exception 'ABORT: ONEST FY2026 moved % / % -> % / %.', v_on_n_b, v_on_s_b, v_on_n_a, v_on_s_a;
  end if;
  if v_sv_n_a <> v_sv_n_b or v_sv_s_a <> v_sv_s_b then
    raise exception 'ABORT: SV FY2026 moved % / % -> % / %.', v_sv_n_b, v_sv_s_b, v_sv_n_a, v_sv_s_a;
  end if;
  if v_al_n_a <> v_al_n_b or v_al_s_a <> v_al_s_b then
    raise exception 'ABORT: All FY2026 moved % / % -> % / %.', v_al_n_b, v_al_s_b, v_al_n_a, v_al_s_a;
  end if;

  -- 5b. Department totals. F and G change an item's category but not its
  --     segment, so neither Marketing nor R&D may move.
  select coalesce(sum(total), 0) into v_mk_a from fy_requests
   where department = 'Marketing' and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  select coalesce(sum(total), 0) into v_rd_a from fy_requests
   where department = 'R&D'       and fyear = 2026 and status in ('CEO_APPROVED', 'PAID');
  raise notice '068 FY2026 approved  Marketing %  ->  %   |   R&D %  ->  %',
    v_mk_b, v_mk_a, v_rd_b, v_rd_a;
  if v_mk_a <> v_mk_b then
    raise exception 'ABORT: Marketing FY2026 total moved % -> %.', v_mk_b, v_mk_a;
  end if;
  if v_rd_a <> v_rd_b then
    raise exception 'ABORT: R&D FY2026 total moved % -> %.', v_rd_b, v_rd_a;
  end if;

  -- 5c. Nothing outside ONEST Marketing moved, and the 14 SV ค่าเดินทาง
  --     requests migration 067 deliberately left alone are byte-identical.
  select count(*) into v_nonon_a from requests
   where department = 'Marketing' and use_for_company <> 'ONEST';
  if v_nonon_a <> v_nonon_b then
    raise exception 'ABORT: non-ONEST Marketing request count went % -> %.', v_nonon_b, v_nonon_a;
  end if;

  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_sv_travel_a
    from (select jsonb_build_object('id', r.request_id, 'l1', r.cat_l1, 'l2', r.cat_l2,
                                    'items', r.items_json) as x
            from requests r
           where r.use_for_company <> 'ONEST'
             and (
               (r.cat_l1 = 'Supporting Budget' and r.cat_l2 = 'ค่าเดินทาง')
               or (jsonb_typeof(r.items_json) = 'array' and exists (
                     select 1 from jsonb_array_elements(r.items_json) e
                      where e ->> 'cat_l1' = 'Supporting Budget'
                        and e ->> 'cat_l2' = 'ค่าเดินทาง'))
             )) s;
  if v_sv_travel_a is distinct from v_sv_travel_b then
    raise exception 'ABORT: the SV ค่าเดินทาง requests changed (% before, % after).',
      jsonb_array_length(v_sv_travel_b), jsonb_array_length(v_sv_travel_a);
  end if;
  raise notice '068 SV ค่าเดินทาง requests untouched: %', jsonb_array_length(v_sv_travel_a);

  -- 5d. The rows that must NOT move: A's rejected request and the two
  --     requests holding B's 4 excluded lines, compared whole.
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_frozen_a
    from (select jsonb_build_object('id', r.request_id, 'items', r.items_json,
                                    'l1', r.cat_l1, 'l2', r.cat_l2) as x
            from requests r
           where r.request_id in
             ('EXP-2026-06-000127', 'EXP-2026-09-000074', 'EXP-2026-10-000112')) s;
  if v_frozen_a is distinct from v_frozen_b then
    raise exception 'ABORT: a frozen request changed — the REJECTED row or a B-excluded row was touched.';
  end if;

  -- and the excluded lines are still literally ''
  select count(*) into v_n
    from requests r
    cross join lateral jsonb_array_elements(r.items_json) e
   where r.request_id in ('EXP-2026-09-000074', 'EXP-2026-10-000112')
     and e ->> 'cat_l1' = 'Brand Building' and e ->> 'cat_l2' = '';
  if v_n <> 4 then
    raise exception 'ABORT: B''s 4 excluded lines are now %.', v_n;
  end if;
  select count(*) into v_n
    from requests r
    cross join lateral jsonb_array_elements(r.items_json) e
   where r.request_id = 'EXP-2026-06-000127'
     and e ->> 'cat_l1' = 'Brand Building' and e ->> 'cat_l2' is null;
  if v_n <> 1 then
    raise exception 'ABORT: the REJECTED Brand Building/NULL line is now %.', v_n;
  end if;

  -- 5e. Destinations grew by exactly the plan, and no more.
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_dest_a from (
    select d.new_l1 || ' | ' || d.new_l2 as k, count(*) as n
      from (select distinct new_l1, new_l2 from plan_068) d
      join requests r on jsonb_typeof(r.items_json) = 'array'
      cross join lateral jsonb_array_elements(r.items_json) e
     where e ->> 'cat_l1' = d.new_l1 and e ->> 'cat_l2' = d.new_l2
     group by 1) z;

  for rec in select distinct p.new_l1 || ' | ' || p.new_l2 as k,
                    (select count(*) from plan_068 q
                      where q.new_l1 = p.new_l1 and q.new_l2 = p.new_l2) as expected
               from plan_068 p loop
    if coalesce((v_dest_a ->> rec.k)::int, 0) - coalesce((v_dest_b ->> rec.k)::int, 0)
       <> rec.expected then
      raise exception 'ABORT: destination % grew by %, expected %.',
        rec.k,
        coalesce((v_dest_a ->> rec.k)::int, 0) - coalesce((v_dest_b ->> rec.k)::int, 0),
        rec.expected;
    end if;
    raise notice '068 dest  % : % -> %  (+%)', rec.k,
      coalesce((v_dest_b ->> rec.k)::int, 0), coalesce((v_dest_a ->> rec.k)::int, 0), rec.expected;
  end loop;

  -- 5f. Sources A-E are empty, except A's frozen rejected line.
  select count(*) into v_left
    from requests r
    cross join lateral jsonb_array_elements(r.items_json) e
   where r.use_for_company = 'ONEST' and r.department = 'Marketing'
     and r.status <> 'REJECTED'
     and (
          (e ->> 'cat_l1' = 'Brand Building'    and e ->> 'cat_l2' is null)
       or (e ->> 'cat_l1' = 'CRM & Retention'   and e ->> 'cat_l2' = '')
       or (e ->> 'cat_l1' = 'Supporting Budget' and e ->> 'cat_l2' is null)
       or (e ->> 'cat_l1' = 'Supporting Budget' and e ->> 'cat_l2' = '')
       or (e ->> 'cat_l1' = 'Brand Building'    and e ->> 'cat_l2' = ''
           and (r.cat_l2 is null or r.cat_l2 = ''))
     );
  if v_left <> 0 then
    raise exception 'ABORT: % source line(s) remain in groups A-E.', v_left;
  end if;

  -- F and G landed.
  if not exists (
    select 1 from requests r
    cross join lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
     where r.request_id = 'EXP-2026-09-000172' and t.ord = 6
       and t.it ->> 'cat_l1' = 'Brand Building'
       and t.it ->> 'cat_l2' = 'Marketing Influencer / KOL'
       and t.it ->> 'segment' = 'Marketing'
  ) then raise exception 'ABORT: F did not land.'; end if;
  if not exists (
    select 1 from requests r
    cross join lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
     where r.request_id = 'EXP-2026-10-000078' and t.ord = 2
       and t.it ->> 'cat_l1' = 'Brand Building'
       and t.it ->> 'cat_l2' = 'PR / Media Exposure / Gifting'
       and t.it ->> 'segment' = 'Marketing'
  ) then raise exception 'ABORT: G did not land.'; end if;

  -- F and G's siblings and headers are untouched.
  if not exists (
    select 1 from requests
     where request_id = 'EXP-2026-09-000172'
       and department = 'R&D' and cat_l1 = 'Product Dev' and cat_l2 = 'RM/PKG Testing'
       and jsonb_array_length(items_json) = 11
  ) then raise exception 'ABORT: EXP-2026-09-000172 header or item count changed.'; end if;
  if not exists (
    select 1 from requests
     where request_id = 'EXP-2026-10-000078'
       and department = 'R&D' and cat_l1 = 'Product Dev'
       and cat_l2 = 'Product Sample (Benchmark)'
       and jsonb_array_length(items_json) = 2
  ) then raise exception 'ABORT: EXP-2026-10-000078 header or item count changed.'; end if;

  drop view fy_requests;

  raise notice '068 DONE  snapshot=% audit=% headers=% requests-with-items-rewritten=%',
    v_snapshot, v_audit, v_headers, v_items;
end $$;
