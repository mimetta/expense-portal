-- roles.department — which department(s) a person BELONGS TO, so an employee
-- can open /reports/spend scoped to their own work.
--
-- ============================================================================
-- department AND dept_scope ARE DIFFERENT FIELDS. DO NOT MERGE THEM.
-- ============================================================================
-- They look alike — both comma-separated department lists on the same table —
-- and a future tidy-up will be tempted to collapse them. That would silently
-- hand approval rights to every employee in the company.
--
--   dept_scope  = what a BUDGET OWNER may APPROVE. Read by
--                 boScopeMatchesRequest, canBoActOnRequest, /bo-approvals,
--                 the BO half of lib/spend.ts#scopeFilter, and the budget
--                 editor's line seeding. Granting it grants power.
--
--   department  = where a PERSON WORKS. Read by exactly one thing:
--                 lib/spend.ts#scopeFilter's non-BO branch, to narrow the
--                 spend report to their own department. It grants visibility
--                 and nothing else.
--
-- Assigning someone a department must NEVER make them a budget owner. If you
-- are reading this because you want one column instead of two: the answer is
-- no. Add a test instead.
--
-- WHY A LIST, NOT A SINGLE VALUE
-- Measured over FY2026's 1,136 departmented requests (see
-- docs/department-assignment.md): giving each person their single most-filed
-- department would hide 294 requests — 25.9% — from the very people who filed
-- them. 17 of 33 filers need two or more departments to see 90% of their own
-- work. Same comma-separated convention as bu_scope/dept_scope/cat_l1_scope,
-- so the existing splitting logic applies unchanged.
--
-- WHY DEFAULT '' AND NOT '*'
-- '*' means "everything" everywhere else in this schema. An unassigned person
-- must see NOTHING until someone decides what they should see — a default of
-- '*' would open the whole company's spend to every employee the moment this
-- migration lands, which is the opposite of the intent. scopeFilter maps an
-- empty department to "none", never "all".

alter table public.roles
  add column if not exists department text not null default '';

comment on column public.roles.department is
  'Comma-separated list of departments this PERSON BELONGS TO. Read ONLY by lib/spend.ts#scopeFilter to scope the spend report. NOT an approval scope — that is dept_scope. Never merge the two. Empty means unassigned, which means see nothing. See migration 034.';

-- Deliberately NOT backfilled from dept_scope, filing history, or chapter.
-- Every existing row stays '' until a human assigns it in
-- Settings > People & departments, with that person's filing history shown
-- next to the field. A guessed backfill would be indistinguishable from a
-- decision once it is in the column.
