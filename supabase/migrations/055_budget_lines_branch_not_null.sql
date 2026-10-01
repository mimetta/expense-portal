-- budget_lines.branch becomes NOT NULL DEFAULT '', for the same reason cat_l2
-- did in migration 029.
--
-- ===========================================================================
-- WHY THIS DEPARTS FROM "A NULLABLE BRANCH", WHICH IS WHAT WAS ASKED FOR.
-- ===========================================================================
-- The MEANING is unchanged: empty means "not branch-split" -- every department
-- except Retail, and the (no branch) bucket within Retail. Only the
-- representation differs, and it has to.
--
-- Saving a budget is an upsert arbitrated by ON CONFLICT, and Postgres can only
-- arbitrate on a unique index matching the named columns. Migration 054 wrote
-- that index as coalesce(branch, ''), which no PostgREST `onConflict` column
-- list can name -- and a plain `branch` in the list would not match the
-- expression index, so every save would error. A NULL column cannot arbitrate
-- ON CONFLICT regardless.
--
-- Migration 029 hit this exact wall with cat_l2 and resolved it the same way;
-- its comment in lib/budget-revisions.ts ("a nullable column cannot arbitrate
-- ON CONFLICT") is still there. Two columns on one table behaving differently
-- for the same problem would be worse than one deviation from the word
-- "nullable".
--
-- CONSEQUENCE WORTH KNOWING: reads must treat '' and NULL alike. Code converts
-- at the boundary -- `branch || null` on the way out, `branch ?? ""` on the way
-- in -- so nothing above the repository layer sees the empty string.
--
-- ROLLBACK
--
--   alter table public.budget_lines alter column branch drop not null;
--   alter table public.budget_lines alter column branch drop default;
--   update public.budget_lines set branch = null where branch = '';
--   drop index if exists budget_lines_uniq;
--   create unique index budget_lines_uniq on public.budget_lines
--     (revision_id, bu, department, cat_l1, coalesce(cat_l2,''), coalesce(branch,''), month);

update public.budget_lines set branch = '' where branch is null;

alter table public.budget_lines
  alter column branch set default '',
  alter column branch set not null;

comment on column public.budget_lines.branch is
  'Retail only. The revenue_channels.channel name this line budgets for. EMPTY STRING = not branch-split (every other department) or the (no branch) bucket within Retail. Empty rather than NULL so ON CONFLICT can arbitrate on it — see migration 055, and cat_l2 in 029 for the same decision.';

-- With branch NOT NULL the coalesce is dead weight, and ON CONFLICT needs the
-- bare column. cat_l2 keeps its coalesce only because the index predates 029;
-- it is equally redundant and left alone rather than churned.
drop index if exists budget_lines_uniq;
create unique index budget_lines_uniq on public.budget_lines
  (revision_id, bu, department, cat_l1, cat_l2, branch, month);

do $$
declare v_null integer; v_retail integer;
begin
  select count(*) into v_null from budget_lines where branch is null;
  if v_null > 0 then
    raise exception 'ABORT: % row(s) still NULL after backfill.', v_null;
  end if;
  select count(*) into v_retail from budget_lines where department = 'Retail' and branch = '';
  raise notice '055: branch NOT NULL DEFAULT ''''. % Retail lines in the (no branch) bucket.', v_retail;
end $$;
