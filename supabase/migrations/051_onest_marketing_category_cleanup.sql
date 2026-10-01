-- Mimetta Expense Portal — ONEST Marketing: retire four leftover cat_l1 names.
--
-- Same snapshot + audit + verify-or-abort pattern as migrations 019, 020, 043.
--
-- ===========================================================================
-- ONEST ONLY. SV IS NOT TOUCHED BY ANY STATEMENT IN THIS FILE.
-- ===========================================================================
-- Every statement below carries `bu = 'ONEST'` (or, for requests, matches on
-- coalesce(use_for_company, bu) = 'ONEST'). SV keeps its own Marketing
-- structure, including its own 'Content Production', 'Marketing
-- Influencer/KOLs' and 'E-Commerce' cat_l1 rows and their GWP / Marketplace
-- children. That is a deliberate instruction, not an oversight — see the note
-- at the foot of this file about what it leaves behind.
--
-- WHAT IS WRONG. ONEST's Marketing categories were reorganised at some point
-- into 'Brand Building' (10 cat_l2) and 'Revenue & Conversion' (8 cat_l2), and
-- all four destination coordinates below ALREADY EXIST and are active. The old
-- flat cat_l1 names were never retired, so ONEST now carries the same concept
-- at two levels at once, and new requests can still be filed against the
-- obsolete one.
--
--   Content Production        (cat_l1, cat_l2 null)
--       -> Brand Building › Content Production
--   Marketing Influencer/KOLs (cat_l1, cat_l2 null)
--       -> Brand Building › Marketing Influencer / KOL
--   E-Commerce › GWP
--       -> Revenue & Conversion › E-Commerce Promotion Support
--   E-Commerce › Marketplace
--       -> Revenue & Conversion › Marketplace Campaign
--
-- and 'E-Commerce' then ceases to be a cat_l1 in ONEST (its only two children
-- are the two above; verified against categories, budget_lines, request
-- headers AND items_json — nothing else has ever been recorded beneath it).
--
-- CAPITALISATION IS LOAD-BEARING. The destinations are 'Brand Building' and
-- 'Revenue & Conversion' with capitals, exactly as stored. The lowercase
-- spellings 'Brand building' / 'Revenue & conversion' differ by one byte each
-- (62 vs 42, 63 vs 43) and would create SECOND, SEPARATE parents rather than
-- matching the existing ones. These constants are the stored bytes.
--
-- NO MONEY MOVES. Only coordinates change. Request amounts, companies and
-- departments are untouched, so FY2026 totals for ONEST, SV and All are
-- unchanged to the satang; only Marketing's internal split shifts.
--
-- ---------------------------------------------------------------------------
-- STEP 1 ROLLBACK (requests; independent of steps 2-4)
--
--   update requests r
--      set cat_l1 = s.cat_l1_original,
--          cat_l2 = s.cat_l2_original,
--          items_json = s.items_json_original
--     from requests_onest_mkt_cleanup_051 s
--    where r.request_id = s.request_id;
--
--   delete from audit_log where action = 'REQUEST_RECATEGORISED'
--     and detail_json ->> 'migration' = '051_onest_marketing_category_cleanup';
--
-- STEP 2 ROLLBACK (budget_lines; independent of steps 1, 3, 4)
--
--   -- undo the sums, then restore the deleted source rows
--   update budget_lines b
--      set amount = b.amount - s.amount_added
--     from budget_lines_onest_mkt_cleanup_051 s
--    where s.kind = 'destination_summed' and b.id = s.line_id;
--
--   insert into budget_lines (id, revision_id, bu, department, cat_l1, cat_l2, month, amount)
--   select line_id, revision_id, bu, department, cat_l1, cat_l2, month, amount
--     from budget_lines_onest_mkt_cleanup_051 where kind = 'source_deleted';
--
--   delete from audit_log where action = 'BUDGET_LINES_RECATEGORISED'
--     and detail_json ->> 'migration' = '051_onest_marketing_category_cleanup';
--
-- STEP 3 ROLLBACK (categories; independent of steps 1, 2, 4)
--
--   update categories c set active = true
--     from categories_onest_mkt_cleanup_051 s
--    where c.id = s.category_id;
--
--   delete from audit_log where action = 'CATEGORY_DEACTIVATED'
--     and detail_json ->> 'migration' = '051_onest_marketing_category_cleanup';
--
-- STEP 4 ROLLBACK (budget_category_order; independent of steps 1-3)
--
--   insert into budget_category_order (owner_email, department, cat_l1, sort_order)
--   select owner_email, department, cat_l1, sort_order
--     from budget_order_onest_mkt_cleanup_051;
-- ---------------------------------------------------------------------------

-- --- snapshots -------------------------------------------------------------

create table if not exists requests_onest_mkt_cleanup_051 (
  request_id text primary key,
  cat_l1_original text,
  cat_l2_original text,
  items_json_original jsonb,
  items_changed integer not null,
  snapshot_at timestamptz not null default now()
);

comment on table requests_onest_mkt_cleanup_051 is
  'Pre-change header and items_json for every ONEST request moved by migration 051. Rollback source for step 1.';

create table if not exists budget_lines_onest_mkt_cleanup_051 (
  snap_id bigserial primary key,
  -- 'source_deleted' = a row removed after its amount was folded into the
  -- destination. 'destination_summed' = a surviving row and how much was
  -- added to it. Both are needed: reversing one without the other would
  -- either double-count or lose the original split.
  kind text not null check (kind in ('source_deleted', 'destination_summed')),
  line_id uuid not null,
  revision_id uuid,
  bu text, department text, cat_l1 text, cat_l2 text,
  month integer, amount numeric,
  amount_added numeric,
  snapshot_at timestamptz not null default now()
);

comment on table budget_lines_onest_mkt_cleanup_051 is
  'Pre-change budget_lines for migration 051 step 2. source_deleted rows are restored verbatim; destination_summed rows record how much to subtract back.';

create table if not exists categories_onest_mkt_cleanup_051 (
  category_id uuid primary key,
  bu text, department text, cat_l1 text, cat_l2 text,
  active_original boolean,
  snapshot_at timestamptz not null default now()
);

comment on table categories_onest_mkt_cleanup_051 is
  'Pre-change ONEST categories rows deactivated by migration 051 step 3. Rollback source.';

create table if not exists budget_order_onest_mkt_cleanup_051 (
  snap_id bigserial primary key,
  owner_email text, department text, cat_l1 text, sort_order integer,
  snapshot_at timestamptz not null default now()
);

comment on table budget_order_onest_mkt_cleanup_051 is
  'Personal category ordering rows pointing at names retired by migration 051 step 4. Rollback source.';

-- --- the work --------------------------------------------------------------

do $$
declare
  v_missing integer;
  v_snapshot integer;
  v_audit integer;
  v_headers integer;
  v_item_reqs integer;
  v_src_snap integer;
  v_dst_snap integer;
  v_summed integer;
  v_converted integer;
  v_deleted integer;
  v_cats integer;
  v_order integer;
  v_amt_before numeric;
  v_amt_after numeric;

  -- Stored bytes. Capitals are deliberate — see the header.
  k_bb  constant text := 'Brand Building';
  k_rc  constant text := 'Revenue & Conversion';
  k_cp  constant text := 'Content Production';
  k_kol constant text := 'Marketing Influencer / KOL';
  k_eps constant text := 'E-Commerce Promotion Support';
  k_mpc constant text := 'Marketplace Campaign';

  k_src_cp  constant text := 'Content Production';
  k_src_kol constant text := 'Marketing Influencer/KOLs';
  k_src_ec  constant text := 'E-Commerce';
begin

  -- The four moves, as data, so every step below reads the same mapping
  -- rather than repeating four near-identical branches.
  create temporary table moves_051 (
    src_l1 text, src_l2 text, dst_l1 text, dst_l2 text
  ) on commit drop;
  insert into moves_051 values
    (k_src_cp,  null,          k_bb, k_cp),
    (k_src_kol, null,          k_bb, k_kol),
    (k_src_ec,  'GWP',         k_rc, k_eps),
    (k_src_ec,  'Marketplace', k_rc, k_mpc);

  -- 0. PRECONDITION. Every destination must already exist and be active in
  --    ONEST. This migration RETIRES names; it does not create any. If a
  --    destination were missing, the result would be spend at a coordinate no
  --    budget can be set against — the exact fault 043 was written to fix.
  select count(*) into v_missing
    from moves_051 m
   where not exists (
     select 1 from categories c
      where c.bu = 'ONEST' and c.department = 'Marketing'
        and c.cat_l1 = m.dst_l1 and c.cat_l2 = m.dst_l2
        and coalesce(c.active, true)
   );
  if v_missing > 0 then
    raise exception 'ABORT: % destination categor(y/ies) missing or inactive in ONEST / Marketing. Check capitalisation: Brand Building / Revenue & Conversion.', v_missing;
  end if;

  select coalesce(sum(amount), 0) into v_amt_before
    from budget_lines where bu = 'ONEST' and department = 'Marketing';

  -- =========================================================================
  -- STEP 1 — requests (headers and items_json)
  -- =========================================================================
  -- Header AND items, because v_request_spend reads the ITEM's cat_l1/cat_l2
  -- with the header only as a fallback (migration 023): changing the header
  -- alone would leave the spend report unmoved.
  --
  -- ONEST is matched on coalesce(use_for_company, bu) — the company the
  -- expense is CHARGED TO, which is what budget ownership keys on since
  -- migration 039, not the business unit that filed it.
  insert into requests_onest_mkt_cleanup_051
    (request_id, cat_l1_original, cat_l2_original, items_json_original, items_changed)
  select
    r.request_id, r.cat_l1, r.cat_l2, r.items_json,
    coalesce((
      select count(*) from jsonb_array_elements(r.items_json) x
       where jsonb_typeof(r.items_json) = 'array'
         and exists (select 1 from moves_051 m
                      where x ->> 'cat_l1' = m.src_l1
                        and (m.src_l2 is null
                             or coalesce(x ->> 'cat_l2', '') = m.src_l2))
    ), 0)
  from requests r
  where r.department = 'Marketing'
    and coalesce(nullif(r.use_for_company, ''), r.bu) = 'ONEST'
    and (
      exists (select 1 from moves_051 m
               where r.cat_l1 = m.src_l1
                 and (m.src_l2 is null or coalesce(r.cat_l2, '') = m.src_l2))
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x
                       join moves_051 m
                         on x ->> 'cat_l1' = m.src_l1
                        and (m.src_l2 is null
                             or coalesce(x ->> 'cat_l2', '') = m.src_l2)))
    )
  on conflict (request_id) do nothing;
  get diagnostics v_snapshot = row_count;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', s.request_id, 'REQUEST_RECATEGORISED',
    jsonb_build_object(
      'field', 'cat_l1/cat_l2 (header and items_json)',
      'from', jsonb_build_object('cat_l1', s.cat_l1_original, 'cat_l2', s.cat_l2_original),
      'items_changed', s.items_changed,
      'company', 'ONEST',
      'reason', 'ONEST Marketing was reorganised into Brand Building / Revenue & Conversion; these flat cat_l1 names are leftovers carrying the same concept at a second level. SV is deliberately untouched.',
      'amount_unchanged', true,
      'migration', '051_onest_marketing_category_cleanup',
      'rollback_source', 'requests_onest_mkt_cleanup_051'
    )
  from requests_onest_mkt_cleanup_051 s;
  get diagnostics v_audit = row_count;

  update requests r
     set cat_l1 = m.dst_l1,
         cat_l2 = m.dst_l2,
         updated_at = now()
    from requests_onest_mkt_cleanup_051 s, moves_051 m
   where r.request_id = s.request_id
     and r.cat_l1 = m.src_l1
     and (m.src_l2 is null or coalesce(r.cat_l2, '') = m.src_l2);
  get diagnostics v_headers = row_count;

  -- ORDER BY ordinality preserves item order — header fields are derived from
  -- items[0] elsewhere in this app.
  update requests r
     set items_json = (
           select jsonb_agg(
                    coalesce((
                      select jsonb_set(jsonb_set(t.it, '{cat_l1}', to_jsonb(m.dst_l1)),
                                       '{cat_l2}', to_jsonb(m.dst_l2))
                        from moves_051 m
                       where t.it ->> 'cat_l1' = m.src_l1
                         and (m.src_l2 is null
                              or coalesce(t.it ->> 'cat_l2', '') = m.src_l2)
                       limit 1
                    ), t.it)
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
         ),
         updated_at = now()
    from requests_onest_mkt_cleanup_051 s
   where r.request_id = s.request_id
     and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array'
     and jsonb_array_length(r.items_json) > 0;
  get diagnostics v_item_reqs = row_count;

  -- =========================================================================
  -- STEP 2 — budget_lines: sum the colliding pair, keep the destination
  -- =========================================================================
  -- Every ONEST source line currently collides with an existing destination
  -- line at the same (revision, company, department, coordinate, month).
  -- Both branches are written anyway so the migration is correct if that
  -- changes between writing and running.

  insert into budget_lines_onest_mkt_cleanup_051
    (kind, line_id, revision_id, bu, department, cat_l1, cat_l2, month, amount)
  select 'source_deleted', b.id, b.revision_id, b.bu, b.department,
         b.cat_l1, b.cat_l2, b.month, b.amount
    from budget_lines b
    join moves_051 m
      on b.cat_l1 = m.src_l1
     and (m.src_l2 is null or coalesce(b.cat_l2, '') = m.src_l2)
   where b.bu = 'ONEST' and b.department = 'Marketing'
     and exists (
       select 1 from budget_lines d
        where d.revision_id = b.revision_id and d.bu = b.bu
          and d.department = b.department
          and d.cat_l1 = m.dst_l1 and d.cat_l2 = m.dst_l2
          and d.month = b.month
     );
  get diagnostics v_src_snap = row_count;

  insert into budget_lines_onest_mkt_cleanup_051
    (kind, line_id, revision_id, bu, department, cat_l1, cat_l2, month, amount, amount_added)
  select 'destination_summed', d.id, d.revision_id, d.bu, d.department,
         d.cat_l1, d.cat_l2, d.month, d.amount,
         sum(coalesce(b.amount, 0))
    from budget_lines d
    join moves_051 m
      on d.cat_l1 = m.dst_l1 and d.cat_l2 = m.dst_l2
    join budget_lines b
      on b.revision_id = d.revision_id and b.bu = d.bu
     and b.department = d.department and b.month = d.month
     and b.cat_l1 = m.src_l1
     and (m.src_l2 is null or coalesce(b.cat_l2, '') = m.src_l2)
   where d.bu = 'ONEST' and d.department = 'Marketing'
   group by d.id, d.revision_id, d.bu, d.department, d.cat_l1, d.cat_l2, d.month, d.amount;
  get diagnostics v_dst_snap = row_count;

  update budget_lines d
     set amount = d.amount + s.amount_added
    from budget_lines_onest_mkt_cleanup_051 s
   where s.kind = 'destination_summed' and d.id = s.line_id;
  get diagnostics v_summed = row_count;

  delete from budget_lines b
   using budget_lines_onest_mkt_cleanup_051 s
   where s.kind = 'source_deleted' and b.id = s.line_id;
  get diagnostics v_deleted = row_count;

  -- Any source line with NO destination is converted in place rather than
  -- dropped — it carries a figure somebody typed.
  update budget_lines b
     set cat_l1 = m.dst_l1, cat_l2 = m.dst_l2
    from moves_051 m
   where b.bu = 'ONEST' and b.department = 'Marketing'
     and b.cat_l1 = m.src_l1
     and (m.src_l2 is null or coalesce(b.cat_l2, '') = m.src_l2);
  get diagnostics v_converted = row_count;

  insert into audit_log (actor_email, request_id, action, detail_json)
  values ('system@migration', null, 'BUDGET_LINES_RECATEGORISED',
    jsonb_build_object(
      'company', 'ONEST', 'department', 'Marketing',
      'source_lines_deleted', v_deleted,
      'destination_lines_summed', v_summed,
      'source_lines_converted', v_converted,
      'rule', 'colliding pair summed into the destination; source row removed',
      'migration', '051_onest_marketing_category_cleanup',
      'rollback_source', 'budget_lines_onest_mkt_cleanup_051'
    ));

  -- =========================================================================
  -- STEP 3 — categories: deactivate the four retired ONEST rows
  -- =========================================================================
  -- SOFT delete, which is what migration 042 added `active` for. A hard delete
  -- would destroy the only record that the name ever existed, and `active` is
  -- already honoured by GET /api/categories and by budget line building
  -- (lib/budget-revisions.ts), so a deactivated row disappears from every
  -- picker without taking its history with it.
  insert into categories_onest_mkt_cleanup_051
    (category_id, bu, department, cat_l1, cat_l2, active_original)
  select c.id, c.bu, c.department, c.cat_l1, c.cat_l2, c.active
    from categories c
   where c.bu = 'ONEST' and c.department = 'Marketing'
     and coalesce(c.active, true)
     and (
       exists (select 1 from moves_051 m
                where c.cat_l1 = m.src_l1
                  and (m.src_l2 is null or coalesce(c.cat_l2, '') = m.src_l2))
       -- plus E-Commerce itself, whose only two children are both above
       or c.cat_l1 = k_src_ec
     )
  on conflict (category_id) do nothing;
  get diagnostics v_cats = row_count;

  update categories c
     set active = false
    from categories_onest_mkt_cleanup_051 s
   where c.id = s.category_id;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'CATEGORY_DEACTIVATED',
    jsonb_build_object(
      'bu', s.bu, 'department', s.department,
      'cat_l1', s.cat_l1, 'cat_l2', s.cat_l2,
      'reason', 'Retired by the ONEST Marketing cleanup; the concept now lives under Brand Building or Revenue & Conversion. SV keeps its own row of the same name.',
      'migration', '051_onest_marketing_category_cleanup',
      'rollback_source', 'categories_onest_mkt_cleanup_051'
    )
  from categories_onest_mkt_cleanup_051 s;

  -- =========================================================================
  -- STEP 4 — budget_category_order: drop orderings for retired names
  -- =========================================================================
  -- Personal drag-to-reorder rows (migration 041) pointing at a cat_l1 that no
  -- longer exists. Harmless but dead; left behind they would silently
  -- re-apply if the name were ever recreated.
  insert into budget_order_onest_mkt_cleanup_051 (owner_email, department, cat_l1, sort_order)
  select o.owner_email, o.department, o.cat_l1, o.sort_order
    from budget_category_order o
   where o.department = 'Marketing'
     and o.cat_l1 in (k_src_cp, k_src_kol, k_src_ec)
     -- Only orderings belonging to an owner whose budget is ONEST. SV owners
     -- keep theirs, because SV keeps the names.
     and exists (select 1 from bo_scopes s
                  where s.email = o.owner_email
                    and coalesce(s.company_scope, s.bu_scope) = 'ONEST');
  get diagnostics v_order = row_count;

  delete from budget_category_order o
   using budget_order_onest_mkt_cleanup_051 s
   where o.owner_email = s.owner_email
     and o.department = s.department
     and o.cat_l1 = s.cat_l1;

  -- =========================================================================
  -- VERIFY OR ABORT. Any RAISE here rolls back all four steps.
  -- =========================================================================
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> request snapshot rows (%).', v_audit, v_snapshot;
  end if;

  select coalesce(sum(amount), 0) into v_amt_after
    from budget_lines where bu = 'ONEST' and department = 'Marketing';
  if v_amt_before <> v_amt_after then
    raise exception 'ABORT: ONEST Marketing budget total moved: % -> %.', v_amt_before, v_amt_after;
  end if;

  if exists (
    select 1 from requests r
     join moves_051 m on r.cat_l1 = m.src_l1
      and (m.src_l2 is null or coalesce(r.cat_l2, '') = m.src_l2)
     where r.department = 'Marketing'
       and coalesce(nullif(r.use_for_company, ''), r.bu) = 'ONEST'
  ) then
    raise exception 'ABORT: ONEST request headers still carry a retired coordinate.';
  end if;

  if exists (
    select 1 from requests r, jsonb_array_elements(r.items_json) x
     join moves_051 m on x ->> 'cat_l1' = m.src_l1
      and (m.src_l2 is null or coalesce(x ->> 'cat_l2', '') = m.src_l2)
     where jsonb_typeof(r.items_json) = 'array'
       and r.department = 'Marketing'
       and coalesce(nullif(r.use_for_company, ''), r.bu) = 'ONEST'
  ) then
    raise exception 'ABORT: ONEST items_json entries still carry a retired coordinate.';
  end if;

  if exists (
    select 1 from budget_lines b
     join moves_051 m on b.cat_l1 = m.src_l1
      and (m.src_l2 is null or coalesce(b.cat_l2, '') = m.src_l2)
     where b.bu = 'ONEST' and b.department = 'Marketing'
  ) then
    raise exception 'ABORT: ONEST budget_lines still carry a retired coordinate.';
  end if;

  if exists (
    select 1 from categories c
     where c.bu = 'ONEST' and c.department = 'Marketing'
       and c.cat_l1 = k_src_ec and coalesce(c.active, true)
  ) then
    raise exception 'ABORT: E-Commerce is still an active cat_l1 in ONEST.';
  end if;

  -- SV MUST BE UNTOUCHED. Asserted, not assumed: all three names stay active
  -- in SV, and SV's E-Commerce keeps both children.
  if (select count(*) from categories c
       where c.bu = 'SV' and c.department = 'Marketing'
         and c.cat_l1 in (k_src_cp, k_src_kol, k_src_ec)
         and coalesce(c.active, true)) <> 4 then
    raise exception 'ABORT: SV Marketing categories changed — expected 4 active rows across the three retired names.';
  end if;

  raise notice '051: requests snapshot=% audit=% headers=% item-reqs=% | lines deleted=% summed=% converted=% | categories=% order=%',
    v_snapshot, v_audit, v_headers, v_item_reqs,
    v_deleted, v_summed, v_converted, v_cats, v_order;
end $$;

-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY LEAVES BEHIND, AND WHY IT IS NOT HALF A JOB
--
-- SV/Marketing keeps 'Content Production', 'Marketing Influencer/KOLs' and
-- 'E-Commerce' (with GWP and Marketplace beneath it) as active cat_l1 rows.
-- After this migration the two companies therefore disagree about where the
-- same concepts live.
--
-- That is the instruction, and it is recorded here so the next reader does not
-- "finish" it by reflex. But the evidence says SV is UN-REORGANISED rather
-- than differently organised: four SV cat_l1 names — Affiliate, Content
-- Production, Live, Website — exist in ONEST as cat_l2 beneath Brand Building
-- or Revenue & Conversion, i.e. ONEST nested exactly what SV left flat. SV has
-- neither parent at all.
--
-- Doing the same for SV is a separate decision with a real prerequisite:
-- akanit.t's bo_scopes.cat_l1_scope lists the OLD names and neither new one,
-- so creating the parents without extending that scope would leave SV
-- Marketing with no budget owner in scope — the fault migration 017 fixed.
--
-- chawanphat.b's ONEST scope already lists both old and new names, so ONEST
-- needs no scope change. Her three now-retired entries are inert, not broken;
-- they are left alone because scope is edited through Settings, with an audit
-- row, not by migration.
-- ---------------------------------------------------------------------------
