-- revenue_sync_runs gains `warnings`, separate from `problems`.
--
-- The two are different kinds of fact and must not share a column:
--
--   problems — why the run REFUSED. Nothing was written. The sheet is wrong
--              and a person has to fix it.
--   warnings — what the run SKIPPED while otherwise succeeding. Figures were
--              written; a channel the portal knows about was not in the sheet
--              and kept its previous values.
--
-- Folding warnings into `problems` would make a successful run look failed on
-- the budget page, which is the one thing the banner exists to distinguish.
--
-- ROLLBACK:  alter table public.revenue_sync_runs drop column warnings;

alter table public.revenue_sync_runs
  add column if not exists warnings jsonb not null default '[]'::jsonb;

comment on column public.revenue_sync_runs.warnings is
  'Channels the portal has that the sheet did not, on an otherwise successful run. Their figures were left unchanged. Distinct from `problems`, which means the run refused and wrote nothing.';
