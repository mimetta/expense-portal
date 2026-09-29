-- Mimetta Expense Portal — merge the 7 CSV-truncation stale budget line groups.
--
-- Same snapshot + audit + verify-or-abort pattern as 019/020/043.
-- See docs/stale-budget-lines.md for the decision sheet these come from.
--
-- WHAT IS WRONG. `categories` was bulk-imported from a CSV with a comma-split
-- parser that does not honour quoted fields, so a value like
-- '"ภงด 1, ภงด 3"' was cut at the comma and stored as '"ภงด 1' — with a
-- literal leading double-quote. `categories` has since been cleaned; the
-- budget lines were not, because a draft's dimensions are frozen at creation
-- (createDraft reads categories once and never again).
--
-- Every one of the 84 lines carries ฿0, so nothing anyone entered is at risk
-- whichever branch each group takes.
--
-- TWO BRANCHES, per the instruction. For each group, if the CLEAN line
-- already exists in the SAME revision the stale one is DELETED rather than
-- renamed — renaming it would create two rows with the same
-- (revision, bu, department, cat_l1, cat_l2, month) coordinate, i.e. a
-- duplicate budget line. Where the clean line does not exist, the stale row is
-- UPDATED to point at it, which preserves the line rather than dropping it.
--
-- Measured before writing:
--   UPDATE branch (no clash) : SV/R&D/Product Dev, ONEST+SV/GA/TAXES,
--                              SV/GA/Legal & Compliance            = 48 lines
--   DELETE branch (clash)    : the three ONEST/New Store Investment
--                              groups                              = 36 lines
--
-- ROLLBACK (step 2 only, independent of 043, 045 and 046):
--
--   -- restore the deleted rows
--   insert into budget_lines (revision_id, bu, department, cat_l1, cat_l2, month, amount)
--   select revision_id, bu, department, cat_l1, cat_l2, month, amount
--     from budget_lines_merge_2026_09 where action = 'DELETE';
--   -- put the renamed rows back to their stale names
--   update budget_lines b
--      set cat_l2 = s.cat_l2
--     from budget_lines_merge_2026_09 s
--    where s.action = 'UPDATE' and b.revision_id = s.revision_id
--      and b.bu = s.bu and b.department = s.department
--      and b.cat_l1 = s.cat_l1 and b.month = s.month
--      and b.cat_l2 = s.cat_l2_new;
--   delete from audit_log where action = 'BUDGET_LINE_MERGED'
--     and detail_json ->> 'migration' = '044_merge_stale_budget_lines';
--
-- ---------------------------------------------------------------------------

create table if not exists budget_lines_merge_2026_09 (
  id bigserial primary key,
  action text not null check (action in ('UPDATE', 'DELETE')),
  revision_id uuid not null,
  bu text not null,
  department text not null,
  cat_l1 text not null,
  cat_l2 text not null,
  cat_l2_new text not null,
  month int not null,
  amount numeric not null,
  snapshot_at timestamptz not null default now()
);

comment on table budget_lines_merge_2026_09 is
  'Pre-change budget_lines for migration 044 (CSV-truncation stale names merged into their clean counterparts). action says whether the row was renamed or dropped as a duplicate. Rollback source.';

do $$
declare
  v_snapshot integer;
  v_updated integer;
  v_deleted integer;
  v_audit integer;
  v_left integer;
begin
  -- The 7 groups, verbatim. The stale cat_l2 values below carry a LITERAL
  -- leading double-quote; that is the corruption, not quoting in this file.
  create temp table m_map (bu text, department text, cat_l1 text, cat_l2_old text, cat_l2_new text) on commit drop;
  insert into m_map values
    ('SV',    'R&D',                    'Product Dev',                 'Product Sample',                        'Product Sample (Benchmark)'),
    ('ONEST', 'General Administrative', 'TAXES',                       '"ภงด 1',                                 'ภงด 1'),
    ('SV',    'General Administrative', 'TAXES',                       '"ภงด 1',                                 'ภงด 1'),
    ('SV',    'General Administrative', 'Legal & Compliance',          '"Contracts & IP (e.g. Agreements',      'Contracts & IP (e.g. Agreements,NDA)'),
    ('ONEST', 'New Store Investment',   'Deposits & Legal Setup',      '"Legal fees (contract review',          'Legal fees (contract review permits)'),
    ('ONEST', 'New Store Investment',   'POS & Technology Setup',      '"POS hardware (tablet',                 'POS hardware (tablet, cash drawer)'),
    ('ONEST', 'New Store Investment',   'Store Design & Construction', '"Engineering',                          'Engineering electrical');

  -- 1. Snapshot every affected row, deciding its branch at snapshot time so
  --    the audit, the write and the rollback all agree on which it was.
  insert into budget_lines_merge_2026_09
    (action, revision_id, bu, department, cat_l1, cat_l2, cat_l2_new, month, amount)
  select
    case when exists (
      select 1 from budget_lines t
       where t.revision_id = b.revision_id and t.bu = b.bu
         and t.department = b.department and t.cat_l1 = b.cat_l1
         and t.cat_l2 = m.cat_l2_new and t.month = b.month
    ) then 'DELETE' else 'UPDATE' end,
    b.revision_id, b.bu, b.department, b.cat_l1, b.cat_l2, m.cat_l2_new, b.month, b.amount
  from budget_lines b
  join m_map m
    on m.bu = b.bu and m.department = b.department
   and m.cat_l1 = b.cat_l1 and m.cat_l2_old = b.cat_l2;
  get diagnostics v_snapshot = row_count;

  if v_snapshot <> 84 then
    raise exception 'ABORT: expected 84 stale lines to merge, found %.', v_snapshot;
  end if;

  if exists (select 1 from budget_lines_merge_2026_09 where amount <> 0) then
    raise exception 'ABORT: a line carries a non-zero figure; this migration assumes all are 0.';
  end if;

  -- Only DRAFT revisions may be touched.
  if exists (
    select 1 from budget_lines_merge_2026_09 s
      join budget_revisions r on r.id = s.revision_id
     where r.status <> 'DRAFT'
  ) then
    raise exception 'ABORT: a non-DRAFT revision is in scope.';
  end if;

  -- 2. One audit row per (revision, group) — a row per month would be twelve
  --    entries saying the same thing.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration', null, 'BUDGET_LINE_MERGED',
    jsonb_build_object(
      'revision_id', s.revision_id,
      'owner_email', r.owner_email,
      'fiscal_year', r.fiscal_year,
      'bu', s.bu, 'department', s.department, 'cat_l1', s.cat_l1,
      'from_cat_l2', s.cat_l2, 'to_cat_l2', s.cat_l2_new,
      'branch', s.action,
      'lines', count(*),
      'amount_total', sum(s.amount),
      'reason', 'CSV comma-split truncation; categories was cleaned but the draft lines were frozen at creation',
      'migration', '044_merge_stale_budget_lines',
      'rollback_source', 'budget_lines_merge_2026_09'
    )
  from budget_lines_merge_2026_09 s
  join budget_revisions r on r.id = s.revision_id
  group by s.revision_id, r.owner_email, r.fiscal_year, s.bu, s.department, s.cat_l1, s.cat_l2, s.cat_l2_new, s.action;
  get diagnostics v_audit = row_count;

  -- 3a. Rename where nothing occupies the clean coordinate.
  update budget_lines b
     set cat_l2 = s.cat_l2_new
    from budget_lines_merge_2026_09 s
   where s.action = 'UPDATE'
     and b.revision_id = s.revision_id and b.bu = s.bu
     and b.department = s.department and b.cat_l1 = s.cat_l1
     and b.cat_l2 = s.cat_l2 and b.month = s.month;
  get diagnostics v_updated = row_count;

  -- 3b. Drop where it is already occupied — a rename would duplicate the line.
  delete from budget_lines b
   using budget_lines_merge_2026_09 s
   where s.action = 'DELETE'
     and b.revision_id = s.revision_id and b.bu = s.bu
     and b.department = s.department and b.cat_l1 = s.cat_l1
     and b.cat_l2 = s.cat_l2 and b.month = s.month;
  get diagnostics v_deleted = row_count;

  -- 4. Verify or abort.
  if v_updated + v_deleted <> v_snapshot then
    raise exception 'ABORT: updated (%) + deleted (%) <> snapshot (%).', v_updated, v_deleted, v_snapshot;
  end if;

  select count(*) into v_left
    from budget_lines b join m_map m
      on m.bu = b.bu and m.department = b.department
     and m.cat_l1 = b.cat_l1 and m.cat_l2_old = b.cat_l2;
  if v_left <> 0 then
    raise exception 'ABORT: % stale line(s) still carry a merged name.', v_left;
  end if;

  raise notice '044: snapshot % | updated % | deleted % | audit %',
    v_snapshot, v_updated, v_deleted, v_audit;
end $$;
