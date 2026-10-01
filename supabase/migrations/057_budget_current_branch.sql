-- Add `branch` to v_budget_current, so branch budget reaches the spend report.
--
-- The DISTINCT ON key gains branch too. Without it, two branches' lines for the
-- same category would collapse to whichever sorted first and the rest of a
-- Retail budget would silently vanish from the report — the view would be
-- picking one branch and calling it the category's budget.
--
-- `branch` is appended LAST in the select list, the same constraint migration
-- 039 documented: create or replace view may only add columns at the end while
-- dependent views exist.
--
-- ROLLBACK: re-run migration 028's v_budget_current definition verbatim.

create or replace view public.v_budget_current as
select distinct on (l.bu, l.department, l.cat_l1, coalesce(l.cat_l2, ''), l.branch, l.month)
  l.bu,
  l.department,
  l.cat_l1,
  l.cat_l2,
  l.month,
  l.amount,
  r.fiscal_year,
  r.owner_email,
  r.id as revision_id,
  r.revision_no,
  r.approved_at,
  l.branch
from public.budget_lines l
join public.budget_revisions r on r.id = l.revision_id
where r.status = 'APPROVED'
order by
  l.bu, l.department, l.cat_l1, coalesce(l.cat_l2, ''), l.branch, l.month,
  r.approved_at desc;
