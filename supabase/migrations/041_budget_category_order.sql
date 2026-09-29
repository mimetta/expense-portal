-- A budget owner's own display order for the categories inside each of their
-- departments.
--
-- THIS IS A DISPLAY PREFERENCE, NOT BUDGET DATA. It is deliberately its own
-- table, not a column on budget_lines and not part of a revision:
--
--   * reordering must never create a revision, change a figure, or write an
--     audit entry against one. A revision is a financial record that a CEO
--     approves; dragging a row is not something to approve.
--   * it is per OWNER, not per revision, so the order survives a revision
--     being submitted, approved or superseded.
--   * it is per owner and NOT global, so one owner's arrangement is invisible
--     to every other owner and to the spend report, which reads neither this
--     table nor anything derived from it.
--
-- WHY THE SERVER AND NOT localStorage: the order belongs to the OWNER. A
-- SUPERADMIN editing on someone's behalf must see that person's arrangement,
-- not their own browser's — which is exactly what localStorage would give
-- them. (Collapse state IS in localStorage, because it is per reader rather
-- than per owner. See components/budget/BudgetGrid.tsx.)
--
-- Rows are sparse: a category with no row here sorts AFTER everything that
-- has one, alphabetically. That is what makes a category newly added in
-- Settings land at the BOTTOM of an existing order instead of silently
-- rearranging it — see lib/budget-order.ts#applyCategoryOrder.

create table if not exists public.budget_category_order (
  owner_email text not null,
  -- The segment. Order is scoped to it, which is the mechanism that stops a
  -- category being dragged from one department into another: a write only
  -- ever rewrites the rows of a single (owner, department) pair.
  department text not null,
  cat_l1 text not null,
  sort_order int not null,
  updated_at timestamptz not null default now(),
  primary key (owner_email, department, cat_l1)
);

create index if not exists budget_category_order_owner
  on public.budget_category_order (owner_email, department);

alter table public.budget_category_order enable row level security;

comment on table public.budget_category_order is
  'Per-owner display order of cat_l1 within a department on /budget. A display preference only: never a revision, never audited against one, never read by the spend report.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   drop table if exists public.budget_category_order;
--
-- Nothing else references it. Dropping it returns every owner to the default
-- alphabetical-by-department order; no budget figure is affected.
-- ---------------------------------------------------------------------------
