-- Mimetta Expense Portal — retire the 8 stale budget line groups whose work
-- moved to another department.
--
-- Same snapshot + audit + verify-or-abort pattern as 019/020/043/044.
-- See docs/stale-budget-lines.md.
--
-- WHAT IS WRONG. 'Factory Investment' and 'Lab Instrument Investment (RD)'
-- used to be cat_l1 values under 'New Store Investment'. Both were promoted to
-- DEPARTMENTS in their own right, keeping their sub-categories as cat_l1s. The
-- 96 lines below are panchita.t's, left behind by that promotion.
--
-- WHY RETIRE AND NOT MERGE. The obvious-looking merge — move them to the new
-- department — is wrong, and this is the reason:
--
--   * the target departments are NOT hers. Factory Investment is scoped to
--     and budgeted by siriwan.b (12-24 lines already present per category);
--     Lab Instrument Investment likewise by kojchaphorn.s.
--   * panchita.t scopes ONEST/Retail and ONEST/New Store Investment only.
--     Lines in her revision for a department she does not scope would be
--     rejected by assertNoScopeOverlap at approval, and would double-count
--     against the owners who already budget them.
--
-- The work moved away from her; her lines should go with it, which means
-- going. All 96 carry ฿0, so nothing entered is lost.
--
-- ROLLBACK (step 3 only, independent of 043, 044 and 046):
--
--   insert into budget_lines (revision_id, bu, department, cat_l1, cat_l2, month, amount)
--   select revision_id, bu, department, cat_l1, cat_l2, month, amount
--     from budget_lines_retired_2026_09;
--   delete from audit_log where action = 'BUDGET_LINE_RETIRED'
--     and detail_json ->> 'migration' = '045_retire_moved_budget_lines';
--
-- ---------------------------------------------------------------------------

create table if not exists budget_lines_retired_2026_09 (
  id bigserial primary key,
  revision_id uuid not null,
  bu text not null,
  department text not null,
  cat_l1 text not null,
  cat_l2 text not null,
  month int not null,
  amount numeric not null,
  moved_to text not null,
  snapshot_at timestamptz not null default now()
);

comment on table budget_lines_retired_2026_09 is
  'Pre-change budget_lines deleted by migration 045 (cat_l1 promoted to a department owned by someone else). moved_to names where the work went. Rollback source.';

do $$
declare
  v_snapshot integer;
  v_deleted integer;
  v_audit integer;
  v_left integer;
begin
  create temp table r_map (department text, cat_l1 text, moved_to text) on commit drop;
  insert into r_map values
    ('New Store Investment', 'Factory Investment',             'department Factory Investment (siriwan.b)'),
    ('New Store Investment', 'Lab Instrument Investment (RD)', 'department Lab Instrument Investment (kojchaphorn.s)');

  -- 1. Snapshot.
  insert into budget_lines_retired_2026_09
    (revision_id, bu, department, cat_l1, cat_l2, month, amount, moved_to)
  select b.revision_id, b.bu, b.department, b.cat_l1, b.cat_l2, b.month, b.amount, m.moved_to
  from budget_lines b
  join r_map m on m.department = b.department and m.cat_l1 = b.cat_l1;
  get diagnostics v_snapshot = row_count;

  if v_snapshot <> 96 then
    raise exception 'ABORT: expected 96 lines to retire, found %.', v_snapshot;
  end if;

  if exists (select 1 from budget_lines_retired_2026_09 where amount <> 0) then
    raise exception 'ABORT: a line carries a non-zero figure; this migration assumes all are 0.';
  end if;

  if exists (
    select 1 from budget_lines_retired_2026_09 s
      join budget_revisions r on r.id = s.revision_id
     where r.status <> 'DRAFT'
  ) then
    raise exception 'ABORT: a non-DRAFT revision is in scope.';
  end if;

  -- 2. One audit row per (revision, group).
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', null, 'BUDGET_LINE_RETIRED',
    jsonb_build_object(
      'revision_id', s.revision_id,
      'owner_email', r.owner_email,
      'fiscal_year', r.fiscal_year,
      'bu', s.bu, 'department', s.department, 'cat_l1', s.cat_l1, 'cat_l2', s.cat_l2,
      'lines', count(*),
      'amount_total', sum(s.amount),
      'moved_to', s.moved_to,
      'reason', 'cat_l1 was promoted to a department now scoped and budgeted by another owner; these lines cannot move with this owner',
      'migration', '045_retire_moved_budget_lines',
      'rollback_source', 'budget_lines_retired_2026_09'
    )
  from budget_lines_retired_2026_09 s
  join budget_revisions r on r.id = s.revision_id
  group by s.revision_id, r.owner_email, r.fiscal_year, s.bu, s.department, s.cat_l1, s.cat_l2, s.moved_to;
  get diagnostics v_audit = row_count;

  -- 3. Delete.
  delete from budget_lines b
   using r_map m
   where m.department = b.department and m.cat_l1 = b.cat_l1;
  get diagnostics v_deleted = row_count;

  -- 4. Verify or abort.
  if v_deleted <> v_snapshot then
    raise exception 'ABORT: deleted (%) <> snapshot (%).', v_deleted, v_snapshot;
  end if;

  select count(*) into v_left
    from budget_lines b join r_map m
      on m.department = b.department and m.cat_l1 = b.cat_l1;
  if v_left <> 0 then
    raise exception 'ABORT: % retired line(s) remain.', v_left;
  end if;

  raise notice '045: snapshot % | deleted % | audit %', v_snapshot, v_deleted, v_audit;
end $$;
