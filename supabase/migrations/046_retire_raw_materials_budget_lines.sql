-- Mimetta Expense Portal — retire the 24 COG › Raw Materials budget lines.
--
-- Same snapshot + audit + verify-or-abort pattern as 019/020/043/044/045.
-- MUST RUN AFTER 043, and the check below enforces that.
--
-- WHY THESE HAVE NO TARGET. Migration 043 moved every request filed at
-- COG cat_l1 'Raw Materials' down a level, to
-- 'Direct Material - COG' › 'Raw Materials'. After it, no request and no
-- `categories` row uses 'Raw Materials' as a cat_l1 under COG at all, so
-- these 24 budget lines point at a coordinate that no longer exists in any
-- sense.
--
-- AND MERGING THEM WOULD COLLIDE. siriwan.b — who owns all 24 — already holds
-- 24 lines at the correct coordinate (COG › Direct Material - COG ›
-- Raw Materials) IN THE SAME REVISION. Renaming these into it would produce
-- two rows per month at one coordinate. Both sets are ฿0, so deleting the
-- stale pair loses nothing and leaves the correct one standing.
--
-- ROLLBACK (step 4 only, independent of 043, 044 and 045):
--
--   insert into budget_lines (revision_id, bu, department, cat_l1, cat_l2, month, amount)
--   select revision_id, bu, department, cat_l1, cat_l2, month, amount
--     from budget_lines_raw_materials_2026_09;
--   delete from audit_log where action = 'BUDGET_LINE_RETIRED'
--     and detail_json ->> 'migration' = '046_retire_raw_materials_budget_lines';
--
-- NOTE the rollback restores lines pointing at a cat_l1 that 043 emptied. If
-- 043 is also being rolled back, roll back 046 first or the restored lines
-- will briefly be stale again — harmless, but it is the honest ordering.
--
-- ---------------------------------------------------------------------------

create table if not exists budget_lines_raw_materials_2026_09 (
  id bigserial primary key,
  revision_id uuid not null,
  bu text not null,
  department text not null,
  cat_l1 text not null,
  cat_l2 text not null,
  month int not null,
  amount numeric not null,
  snapshot_at timestamptz not null default now()
);

comment on table budget_lines_raw_materials_2026_09 is
  'Pre-change budget_lines deleted by migration 046 (COG Raw Materials cat_l1 emptied by 043; the correct coordinate already held lines in the same revision). Rollback source.';

do $$
declare
  v_snapshot integer;
  v_deleted integer;
  v_audit integer;
  v_left integer;
  v_requests integer;
begin
  -- 0. ORDERING GUARD. If requests still sit at this cat_l1, 043 has not run
  --    and deleting the budget lines would strand live spend.
  select count(*) into v_requests
    from requests r where r.department = 'COG' and r.cat_l1 = 'Raw Materials';
  if v_requests > 0 then
    raise exception 'ABORT: % request(s) still filed at COG / Raw Materials. Run 043 first.', v_requests;
  end if;

  -- 1. Snapshot.
  insert into budget_lines_raw_materials_2026_09
    (revision_id, bu, department, cat_l1, cat_l2, month, amount)
  select b.revision_id, b.bu, b.department, b.cat_l1, b.cat_l2, b.month, b.amount
    from budget_lines b
   where b.department = 'COG' and b.cat_l1 = 'Raw Materials';
  get diagnostics v_snapshot = row_count;

  if v_snapshot <> 24 then
    raise exception 'ABORT: expected 24 lines, found %.', v_snapshot;
  end if;

  if exists (select 1 from budget_lines_raw_materials_2026_09 where amount <> 0) then
    raise exception 'ABORT: a line carries a non-zero figure; this migration assumes all are 0.';
  end if;

  if exists (
    select 1 from budget_lines_raw_materials_2026_09 s
      join budget_revisions r on r.id = s.revision_id
     where r.status <> 'DRAFT'
  ) then
    raise exception 'ABORT: a non-DRAFT revision is in scope.';
  end if;

  -- 2. One audit row per (revision, company).
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', null, 'BUDGET_LINE_RETIRED',
    jsonb_build_object(
      'revision_id', s.revision_id,
      'owner_email', r.owner_email,
      'fiscal_year', r.fiscal_year,
      'bu', s.bu, 'department', s.department, 'cat_l1', s.cat_l1,
      'lines', count(*),
      'amount_total', sum(s.amount),
      'reason', 'cat_l1 emptied by migration 043; the correct coordinate (Direct Material - COG / Raw Materials) already holds lines in this same revision, so merging would duplicate',
      'migration', '046_retire_raw_materials_budget_lines',
      'rollback_source', 'budget_lines_raw_materials_2026_09'
    )
  from budget_lines_raw_materials_2026_09 s
  join budget_revisions r on r.id = s.revision_id
  group by s.revision_id, r.owner_email, r.fiscal_year, s.bu, s.department, s.cat_l1;
  get diagnostics v_audit = row_count;

  -- 3. Delete.
  delete from budget_lines b
   where b.department = 'COG' and b.cat_l1 = 'Raw Materials';
  get diagnostics v_deleted = row_count;

  -- 4. Verify or abort.
  if v_deleted <> v_snapshot then
    raise exception 'ABORT: deleted (%) <> snapshot (%).', v_deleted, v_snapshot;
  end if;

  select count(*) into v_left
    from budget_lines b where b.department = 'COG' and b.cat_l1 = 'Raw Materials';
  if v_left <> 0 then
    raise exception 'ABORT: % line(s) remain.', v_left;
  end if;

  raise notice '046: snapshot % | deleted % | audit %', v_snapshot, v_deleted, v_audit;
end $$;
