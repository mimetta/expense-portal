# supabase/pending

Migration files that are **written but not applied**, parked outside
`supabase/migrations/` on purpose.

`supabase db push` reads `supabase/migrations/` — not git. An unapplied file
sitting in that directory means push can never be a clean no-op, and if the
file sorts *before* a migration that has been applied (as 015 does, against
the applied 016), the CLI refuses to run at all without `--include-all`.
Moving a parked migration here keeps it in the working tree, and out of the
path push walks.

Nothing in this directory is applied by any tooling. Moving a file back into
`supabase/migrations/` is what schedules it.

---

## 015_budget_cashflow.sql

Ports the separate "Onest Cash Flow" app's P&L tool into this project as the
Budget page. Creates five tables — `cashflow_departments`,
`cashflow_categories`, `cashflow_line_items`, `cashflow_budget_submissions`,
`cashflow_line_item_map` — plus the `cashflow_actuals` view, which live-sums
PAID ONEST requests through the mapping table.

**Partially applied — read this before running it.** The file's
`roles_role_check` statement, which adds `DEPT_HEAD` to the allowed role
list, was run against the remote database by hand and is live: `DEPT_HEAD`
rows exist in `roles` today, and that role owns Product/SKU management via
`lib/permissions.ts#canManageProducts`. **That part stays.** If 015 is ever
applied in full, expect the `roles_role_check` block to be a no-op rather
than a change.

Everything else in the file is outstanding. All six relations above return
Postgrest `PGRST205` ("table not found in schema cache") against the remote
database.

**Why it is parked.** The ONEST P&L page (`app/budget/`, `lib/budget/`,
`components/budget/`) is undecided. Its schema does not line up with the
`budgets` table migration 016 created for the spend report:

|                | `cashflow_budget_submissions` (015) | `budgets` (016)                                     |
| -------------- | ----------------------------------- | --------------------------------------------------- |
| grain          | `line_item_id` × month              | `bu`+`department`+`cat_l1`+`cat_l2` × year+month      |
| dimensions     | its own `cashflow_*` hierarchy      | the free-text values already on `requests`            |
| scope          | ONEST only                          | any BU                                                |
| read by        | the Budget page                     | the spend report (`lib/spend.ts`)                     |
| revisions      | `unique(line_item_id, month)`       | `budgets_uniq` — also one row, overwritten            |

They are two parallel budget stores that cannot see each other: a figure
entered on the Budget page does not move the spend report, and vice versa.
Applying 015 as-is would make that split permanent, so the decision on
whether the Budget page is extended, replaced, or dropped needs to come
first.

Note also that `lib/budget/data.ts` never checks `.error` on its queries — it
uses `res.data ?? []` throughout — so with these tables absent the Budget
page renders a structurally complete P&L of all zeros rather than failing
visibly.
