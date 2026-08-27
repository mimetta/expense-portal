-- Mimetta Expense Portal — budget_lines.cat_l2 NOT NULL, so upsert works
--
-- Migration 028 gave budget_lines a unique INDEX on
--   (revision_id, bu, department, cat_l1, coalesce(cat_l2,''), month)
-- because cat_l2 was nullable and NULL <> NULL would otherwise let duplicate
-- "no cat_l2" lines through.
--
-- That is correct as a constraint but unusable as an ON CONFLICT arbiter:
-- Postgres requires a unique constraint or index on the LITERAL columns, so
-- every upsert from saveDraft failed with 42P10 "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification". Found by
-- walking the editor loop end-to-end, not by reading the code.
--
-- The fix available to 028's own table but NOT to `categories`: make cat_l2
-- NOT NULL DEFAULT ''. budget_lines is new and its writers all go through
-- lib/budget-revisions.ts, so there is no legacy data to reconcile and no
-- external consumer of a NULL. (categories cannot take the same treatment —
-- it has 352 live rows feeding /submit's pickers, which is exactly why the
-- foreign key documented in 028 remains impossible.)
--
-- '' and NULL are already equivalent downstream: lib/spend.ts#label() maps
-- both to "(uncategorized)", and lib/budget-editor.ts keys rows on
-- `cat_l2 ?? ""`. So this changes storage, not behaviour.

update public.budget_lines set cat_l2 = '' where cat_l2 is null;

alter table public.budget_lines
  alter column cat_l2 set default '',
  alter column cat_l2 set not null;

drop index if exists public.budget_lines_uniq;

-- Now a plain constraint on the literal columns, which upsert can arbitrate.
alter table public.budget_lines
  add constraint budget_lines_uniq
  unique (revision_id, bu, department, cat_l1, cat_l2, month);
