-- Branch-level budgeting, for Retail.
--
-- ===========================================================================
-- THIS IS DELIBERATELY RETAIL-ONLY. DO NOT GENERALISE IT WITHOUT ASKING.
-- ===========================================================================
-- No other department is branch-split, and there is deliberately NO
-- per-department setting controlling it -- a rule naming Retail is the whole
-- mechanism (lib/branches.ts#BRANCH_SPLIT_DEPARTMENTS). A settings table or a
-- flag column would invite someone to switch branch-splitting on for a
-- department whose spend carries no branch at all, producing a budget that can
-- never be compared against anything.
--
-- If a second department ever genuinely needs this, that is a decision to take
-- deliberately, with the spend side checked first -- not a config toggle to
-- flip. Read this paragraph before widening the rule.
--
-- ---------------------------------------------------------------------------
-- A BRANCH IS A REVENUE CHANNEL. THERE IS NO BRANCHES TABLE.
--
-- Retail branches ARE the ONEST Physical store rows of `revenue_channels` --
-- Owned store, Specialty partners (sell/use/closed) and Event. The same
-- entity, the same list, one place to add or close a branch. `branch` below
-- holds the channel NAME rather than its id, matching how requests already
-- record a branch (requests.product, and items_json[].product for Retail petty
-- cash) and how `categories`/`dept_config` reference things by value
-- throughout this schema. A FK to revenue_channels(id) would be tidier in
-- isolation but could not join to the spend side at all, which is the one
-- comparison this feature exists to make.
--
-- CLOSED BRANCHES follow the rule revenue goals already use, reused rather
-- than rewritten: lib/revenue-goals.ts#isClosedChannel. A closed branch (DCP)
-- keeps every historical budget line and every past figure, and is refused
-- only when opening a fiscal year it has no lines in.
--
-- ---------------------------------------------------------------------------
-- NULL MEANS NOT BRANCH-SPLIT, AND THAT IS MOST OF THE TABLE.
--
-- Every department except Retail is null. A Retail line is null too when it
-- belongs to the "(no branch)" bucket -- spend that is genuinely not
-- attributable to one branch, which Retail's own data already needs: 26 FY2026
-- requests name the branch "All branch".
--
-- The 696 existing Retail lines KEEP branch = null and become (no branch)
-- lines. They are not deleted and not re-seeded per branch:
--   * all 696 are 0.00 and every one sits in a DRAFT revision, so no figure is
--     preserved or lost either way -- but deleting 696 rows is irreversible
--     and leaving them is not;
--   * re-seeding would be 39 coordinates x 16 branches per revision per
--     company, thousands of rows almost all of which would stay empty. The
--     editor already materialises lines from `categories` on demand
--     (lib/budget-revisions.ts#refreshDraftLines), so a branch's lines appear
--     when somebody actually budgets for it;
--   * SV Retail lines must stay null regardless -- branches are ONEST
--     Physical store channels and SV has none -- so this keeps one rule.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   drop index if exists budget_lines_uniq;
--   create unique index budget_lines_uniq on public.budget_lines
--     (revision_id, bu, department, cat_l1, coalesce(cat_l2, ''), month);
--   alter table public.budget_lines drop column if exists branch;
--
-- Safe while every branch is null. Once branch lines exist, dropping the
-- column merges them into one line per coordinate and the recreated unique
-- index will REJECT the duplicates -- delete the branch-carrying rows first,
-- or accept losing them.
-- ---------------------------------------------------------------------------

alter table public.budget_lines
  add column if not exists branch text;

comment on column public.budget_lines.branch is
  'Retail only. The revenue_channels.channel name this line budgets for. NULL = not branch-split (every other department) or the (no branch) bucket within Retail. See migration 054 -- deliberately not generalised beyond Retail.';

-- THE UNIQUE INDEX MUST INCLUDE BRANCH, or two branches cannot hold the same
-- category in the same revision -- which is the entire feature. coalesce for
-- the same reason cat_l2 needs it: NULL <> NULL in an index, so without it
-- every (no branch) line would be free to duplicate.
-- Dropped as a CONSTRAINT first, then as an index. Migration 028's header says
-- it created a unique INDEX (a table constraint cannot hold the coalesce
-- expression), but the live database answers `cannot drop index ... because
-- constraint budget_lines_uniq requires it` -- so on this database it is
-- constraint-backed. Both forms are handled rather than guessing which, since
-- the two cannot be dropped the same way.
alter table public.budget_lines drop constraint if exists budget_lines_uniq;
drop index if exists budget_lines_uniq;
create unique index budget_lines_uniq on public.budget_lines
  (revision_id, bu, department, cat_l1, coalesce(cat_l2, ''), coalesce(branch, ''), month);

-- The editor loads one branch at a time, so the lookup leads with the revision
-- and narrows by branch.
create index if not exists budget_lines_rev_branch
  on public.budget_lines (revision_id, department, branch);

do $$
declare
  v_retail integer;
  v_nonnull integer;
  v_nonzero integer;
begin
  select count(*) into v_retail from budget_lines where department = 'Retail';
  select count(*) into v_nonnull from budget_lines where branch is not null;
  select count(*) into v_nonzero from budget_lines where department = 'Retail' and amount <> 0;

  -- The decision above rests on "every existing Retail line is zero". If that
  -- stopped being true between writing this and running it, the reasoning no
  -- longer holds and somebody should re-read it rather than let the migration
  -- quietly proceed on a stale premise.
  if v_nonzero > 0 then
    raise exception 'ABORT: % Retail budget_line(s) now carry a non-zero amount. The "leave them as (no branch)" decision in this header assumed all were 0.00 -- re-check it before applying.', v_nonzero;
  end if;

  if v_nonnull > 0 then
    raise exception 'ABORT: % budget_line(s) already carry a branch; this migration expects to be the first to set one.', v_nonnull;
  end if;

  raise notice '054: branch column added. % Retail lines kept as (no branch), all 0.00, all DRAFT.', v_retail;
end $$;
