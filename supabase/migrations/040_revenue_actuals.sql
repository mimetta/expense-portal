-- Revenue ACTUALS, alongside the existing goal.
--
-- A goal is what the CEO planned; an actual is what the business took. Both
-- live on the same row, keyed (channel_id, fiscal_year, month), so one read
-- gives the pair and there is no second tree to line up by eye.
--
-- NULL IS NOT ZERO, and the distinction is the whole point. A null actual
-- means "not known yet" — a month that has not happened, or that the sync has
-- not reached. It renders as an em dash everywhere, never as 0, because a
-- zero would read as "we took nothing" and make every percentage built on it
-- a lie. `amount` (the goal) keeps its `not null default 0` because a goal of
-- zero IS a deliberate target; an actual has no such meaning.
--
-- WHY actual_source EXISTS. Actuals are not hand-entered in normal use: they
-- will be synced from a Google Sheets REVENUE_SYNC tab in a later change.
-- Manual entry is allowed NOW, by CEO/SUPERADMIN only, so the feature can be
-- used and tested before the sync exists. When the sync lands it must not
-- silently overwrite a figure a human typed without that being visible, so
-- every write records which it was. 'sheet' is reserved for the sync.
--
-- PERMISSION IS UNCHANGED: writing an actual is the same CEO/SUPERADMIN gate
-- as writing a goal (lib/revenue-goals.ts#assertCanEditRevenueGoals). A BO
-- reads both and plans against them.

alter table public.revenue_goals
  add column if not exists actual_amount numeric(14,2),
  add column if not exists actual_source text,
  add column if not exists actual_synced_at timestamptz;

-- Only constrains rows that HAVE an actual, so the existing 0 rows are
-- untouched and a null source stays legal while nothing has been entered.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'revenue_goals_actual_source_check'
  ) then
    alter table public.revenue_goals
      add constraint revenue_goals_actual_source_check
      check (actual_source is null or actual_source in ('sheet', 'manual'));
  end if;
end $$;

comment on column public.revenue_goals.actual_amount is
  'Revenue actually taken for this channel/month. NULL = not yet known — renders as an em dash, NEVER zero. Contrast `amount` (the goal), where 0 is a deliberate target.';
comment on column public.revenue_goals.actual_source is
  '''sheet'' (synced from the revenue sheet) or ''manual'' (typed by a CEO/admin). Recorded so a later sync cannot silently overwrite a hand-entered figure without it being visible.';
comment on column public.revenue_goals.actual_synced_at is
  'When the actual was last written, by either route. Surfaced as the "synced" timestamp on the budget page.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   alter table public.revenue_goals
--     drop column if exists actual_amount,
--     drop column if exists actual_source,
--     drop column if exists actual_synced_at;
--   alter table public.revenue_goals
--     drop constraint if exists revenue_goals_actual_source_check;
--
-- No goal data is touched by this migration, so nothing else needs undoing.
-- ---------------------------------------------------------------------------
