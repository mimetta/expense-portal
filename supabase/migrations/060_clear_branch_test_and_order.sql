-- Two unrelated housekeeping steps, each independently reversible.
--
-- ---------------------------------------------------------------------------
-- STEP 1 — remove the branch test figure.
--
-- Verifying that a branch line could be typed, saved and re-read left a real
-- ฿123,456 in panchita.t's FY2026 draft (Song Wat, Store Fixed cost > Store
-- rental fee, January). The 12 rows are DELETED rather than zeroed, so the
-- draft returns to the state it was in before the test: before it, no
-- budget_line carried a branch at all, and a row of zeroes is not the same
-- thing as no row — the editor materialises a line when somebody budgets, and
-- leaving twelve zeroes would assert that somebody did.
--
-- Checked before writing: these 12 are the ONLY branch-carrying rows in the
-- table, so nothing else materialised alongside them. Asserted below.
--
-- ROLLBACK (step 1): there is nothing to restore — the pre-test state is the
-- absence of these rows. To recreate the test figure, type it again.
--
-- ---------------------------------------------------------------------------
-- STEP 2 — sort_order to match the agreed branch hierarchy order.
--
-- The order within each group is deliberate and is NOT alphabetical. Two
-- channels sat in the wrong place:
--   * Loft eyes-Thong Lor belongs directly after Loft eyes (100 -> 35)
--   * Emporium belongs before Loopers (Event renumbered 10/20/30/40)
--
-- Held in sort_order rather than hardcoded in the component, so adding a store
-- is a data change. The GROUP order (Owned store, Specialty partners, Event)
-- and the STATUS order (sell, use, closed) stay in code: they are structural,
-- there are three of each, and they are not things an admin edits.
--
-- ROLLBACK (step 2):
--   update revenue_channels set sort_order = 100 where channel = 'Loft eyes-Thong Lor';
--   update revenue_channels set sort_order = 20  where channel = 'Central Chidlom';
--   update revenue_channels set sort_order = 30  where channel = 'Loopers';
--   update revenue_channels set sort_order = 40  where channel = 'Emporium';
--   update revenue_channels set sort_order = 50  where channel = 'LOQA';
-- ---------------------------------------------------------------------------

do $$
declare
  v_deleted integer;
  v_other integer;
  v_left integer;
begin
  -- Nothing but the test may be carrying a branch. If that is no longer true
  -- someone has started budgeting by branch for real, and a blanket assumption
  -- here would delete their work.
  select count(*) into v_other
    from budget_lines
   where branch <> ''
     and not (branch = 'Song Wat' and department = 'Retail'
              and cat_l1 = 'Store Fixed cost' and cat_l2 = 'Store rental fee');
  if v_other > 0 then
    raise exception 'ABORT: % branch-carrying budget_line(s) exist beyond the test row. Someone has budgeted by branch — remove the test by hand instead.', v_other;
  end if;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'BUDGET_LINES_DELETED',
    jsonb_build_object(
      'revision_id', revision_id,
      'bu', bu, 'department', department,
      'cat_l1', cat_l1, 'cat_l2', cat_l2, 'branch', branch,
      'months', count(*), 'sum_removed', sum(amount),
      'reason', 'Test figure from verifying branch line materialisation. Deleted rather than zeroed: before the test no budget_line carried a branch, and twelve zero rows would assert that somebody had budgeted.',
      'migration', '060_clear_branch_test_and_order'
    )
    from budget_lines
   where branch = 'Song Wat' and department = 'Retail'
     and cat_l1 = 'Store Fixed cost' and cat_l2 = 'Store rental fee'
   group by revision_id, bu, department, cat_l1, cat_l2, branch;

  delete from budget_lines
   where branch = 'Song Wat' and department = 'Retail'
     and cat_l1 = 'Store Fixed cost' and cat_l2 = 'Store rental fee';
  get diagnostics v_deleted = row_count;

  if v_deleted <> 12 then
    raise exception 'ABORT: deleted % rows, expected exactly 12 (one per month).', v_deleted;
  end if;

  select count(*) into v_left from budget_lines where branch <> '';
  if v_left > 0 then
    raise exception 'ABORT: % branch-carrying row(s) remain.', v_left;
  end if;

  raise notice '060 step 1: % test rows deleted, 0 branch-carrying rows remain.', v_deleted;
end $$;

-- Step 2. Plain updates; sort_order carries no meaning beyond ordering.
update public.revenue_channels set sort_order =  35 where bu = 'ONEST' and channel = 'Loft eyes-Thong Lor';
update public.revenue_channels set sort_order =  10 where bu = 'ONEST' and channel = 'Central Chidlom';
update public.revenue_channels set sort_order =  20 where bu = 'ONEST' and channel = 'Emporium';
update public.revenue_channels set sort_order =  30 where bu = 'ONEST' and channel = 'Loopers';
update public.revenue_channels set sort_order =  40 where bu = 'ONEST' and channel = 'LOQA';
