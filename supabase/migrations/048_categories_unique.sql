-- Mimetta Expense Portal — make a category coordinate unique.
--
-- `categories` has had no uniqueness since 001: just `id uuid primary key`
-- and a NON-unique index on (bu, department). A duplicate row was therefore
-- insertable, and verified so — cloning an existing row through the API was
-- accepted (the probe was removed immediately).
--
-- WHY IT MATTERS: the spend report groups the drill-down by NAME, not by id.
-- Two rows at one coordinate would double-count a category in the tree.
-- Nothing has exploited it yet — 344 rows, 344 distinct coordinates — but
-- Add New Category and PATCH both can, and only Bulk Import is safe (it
-- dedupes in application code precisely because there was no constraint to
-- upsert against; see 018 and 022).
--
-- WHY AN EXPRESSION INDEX AND NOT A TABLE CONSTRAINT. cat_l2 is NULLABLE and
-- 60 rows use NULL for "this category has no second level". In SQL two NULLs
-- are never equal, so a plain UNIQUE (bu, department, cat_l1, cat_l2) would
-- happily accept a hundred rows for the same cat_l1 with a NULL cat_l2 — the
-- exact duplicate this is meant to stop. coalesce(cat_l2, '') collapses them
-- to one comparable value. A UNIQUE CONSTRAINT cannot hold an expression;
-- only a unique INDEX can. Same shape and same reasoning as migration 028's
-- budget_lines_uniq, which hit this identically.
--
-- Checked before creating: 0 violations of exactly this expression, 0 NULL
-- cat_l1, 60 NULL cat_l2, 0 empty-string cat_l2.
--
-- ROLLBACK:
--
--   drop index if exists categories_coordinate_uniq;
--
-- No data is modified by this migration.

create unique index if not exists categories_coordinate_uniq
  on public.categories (bu, department, cat_l1, coalesce(cat_l2, ''));

comment on index public.categories_coordinate_uniq is
  'One row per (company, department, cat_l1, cat_l2). coalesce because cat_l2 is nullable and NULL <> NULL would let duplicates through — see migration 048.';
