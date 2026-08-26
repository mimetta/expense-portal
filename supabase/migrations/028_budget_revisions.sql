-- Mimetta Expense Portal — budget revisions (budget editor, phase 1)
--
-- Replaces the `budgets` table from migration 016. That table was a flat
-- one-row-per-figure store with no notion of authorship, draft state or
-- approval; it never held a single row (verified 0 before this ran), so it is
-- dropped rather than migrated. 016 is left exactly as it was — the record of
-- what was built then, not a place to retro-fit.
--
-- ---------------------------------------------------------------------------
-- THE CENTRAL MODELLING POINT: a revision belongs to a BUDGET OWNER, not to a
-- segment.
--
-- BO scope is (bu_scope, dept_scope, cat_l1_scope), and those cross-cut
-- departments. wacharanan.j owns `HR Salary` across six departments — COG,
-- Marketing, Operations/Fulfillment, People (HR), R&D and Retail — so one of
-- their revisions spans six segments. siriwan.b owns COG's six OTHER cat_l1s
-- and raises a separate revision. Neither owns "COG"; between them they own
-- all of it.
--
-- A segment's budget is therefore ASSEMBLED from several owners' revisions,
-- and no single revision can be said to be "the budget for COG". This is why
-- v_budget_current resolves the winner PER LINE rather than per revision —
-- see the comment on that view.
-- ---------------------------------------------------------------------------

drop view if exists public.v_budget_current;
drop table if exists public.budgets;

create table public.budget_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  fiscal_year int not null,
  revision_no int not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  created_by text not null,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enforced in the DATABASE, not only in lib/budget-revisions.ts: a user who
  -- holds both BO and CEO can submit a revision but must not approve their
  -- own. A code-only check would be bypassed by any direct write.
  constraint no_self_approval check (approved_by is null or approved_by <> submitted_by),
  constraint approved_has_approver check (status <> 'APPROVED' or approved_by is not null),
  -- Rejection must say why — the note is what the BO amends against.
  constraint rejected_has_note check (status <> 'REJECTED' or note is not null),
  unique (owner_email, fiscal_year, revision_no)
);

-- One live draft and one pending submission per owner per year. Partial
-- unique indexes rather than constraints, since the uniqueness only applies
-- to those two statuses — APPROVED/REJECTED/SUPERSEDED rows accumulate freely
-- as the audit trail.
create unique index one_draft_per_owner on public.budget_revisions
  (owner_email, fiscal_year) where status = 'DRAFT';
create unique index one_submitted_per_owner on public.budget_revisions
  (owner_email, fiscal_year) where status = 'SUBMITTED';

create index budget_revisions_owner_year on public.budget_revisions (owner_email, fiscal_year);
create index budget_revisions_status on public.budget_revisions (status);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.budget_revisions (id) on delete cascade,
  bu text not null,
  department text not null,
  cat_l1 text not null,
  cat_l2 text,
  month int not null check (month between 1 and 12),
  amount numeric(14, 2) not null default 0
);

-- SPEC CORRECTION: this was given as an inline `unique (..., coalesce(cat_l2,''), ...)`
-- table constraint. Postgres table constraints cannot contain expressions —
-- only a unique INDEX can — so it is expressed as one here. Same shape and
-- same effect, and the same reason 016's budgets_uniq was written this way:
-- without the coalesce, NULL <> NULL would let unlimited duplicate
-- "no cat_l2" lines through.
create unique index budget_lines_uniq on public.budget_lines
  (revision_id, bu, department, cat_l1, coalesce(cat_l2, ''), month);

create index budget_lines_rev on public.budget_lines (revision_id);
create index budget_lines_key on public.budget_lines (bu, department, cat_l1, month);

-- ---------------------------------------------------------------------------
-- WHY budget_lines IS NOT FOREIGN-KEYED TO categories
--
-- It cannot be. A Postgres foreign key must reference columns carrying a
-- UNIQUE or PRIMARY KEY constraint, and `categories` offers neither for the
-- natural key:
--
--   * its PRIMARY KEY is a surrogate `id uuid`, not (bu, department, cat_l1,
--     cat_l2);
--   * it has NO unique constraint on those columns — deliberately, see
--     CLAUDE.md and migration 018: the bulk importer dedupes in application
--     code precisely because there is nothing to ON CONFLICT against;
--   * `categories.cat_l2` is NULLABLE, so any uniqueness would have to be
--     `coalesce(cat_l2,'')` — an EXPRESSION index, which a foreign key cannot
--     reference even if one were added;
--   * `categories.cat_l1` is nullable too, while budget_lines.cat_l1 is not.
--
-- Adding a plain unique constraint would mean making cat_l2 NOT NULL DEFAULT
-- '' on a live 352-row table that feeds /submit's pickers — a destructive
-- change well outside this migration's scope. (The data would permit it
-- today: 352 rows, 352 distinct natural keys, 0 duplicates, 0 null cat_l1.)
--
-- So the constraint is enforced in the state machine instead:
-- lib/budget-revisions.ts validates every line against `categories` on
-- createDraft (it only ever seeds from real rows) and again on saveDraft
-- (rejecting the whole save, naming the offending line). Because writes only
-- ever reach these tables through those functions — RLS below denies
-- everything else — that is the effective boundary.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- v_budget_current — the live approved budget, resolved PER LINE.
--
-- DISTINCT ON the line key, ordered by approved_at desc, so the winner is the
-- most recently approved revision THAT CONTAINS THAT LINE — not the most
-- recently approved revision overall, and not "the" revision for the segment.
--
-- That distinction is the whole point of the owner-scoped model. Worked
-- example, both in COG:
--   siriwan.b   approves rev 1 on 1 Mar covering COG's Raw Materials, NPD, ...
--   wacharanan.j approves rev 1 on 5 Mar covering HR Salary in six departments,
--               COG among them.
-- A per-revision "latest wins" would let the 5 Mar approval blank siriwan.b's
-- COG lines, because that revision simply does not contain them. Per-line, each
-- owner's lines stand until that owner supersedes them.
-- ---------------------------------------------------------------------------
create or replace view public.v_budget_current as
select distinct on (l.bu, l.department, l.cat_l1, coalesce(l.cat_l2, ''), l.month)
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
  r.approved_at
from public.budget_lines l
join public.budget_revisions r on r.id = l.revision_id
where r.status = 'APPROVED'
order by
  l.bu, l.department, l.cat_l1, coalesce(l.cat_l2, ''), l.month,
  r.approved_at desc;

-- ---------------------------------------------------------------------------
-- RLS — enabled, no policies, per this project's established convention
-- (001_initial_schema.sql lines 244-251, and 008/010/016 since): every table
-- is default-deny for anon/authenticated and all access goes through server
-- code holding the service-role key.
--
-- The brief said "SELECT for authenticated". A policy to that effect would be
-- INERT here: `authenticated` and `anon` hold no table grants in this project
-- at all, so PostgREST refuses with 42501 "permission denied" before RLS is
-- ever consulted (verified directly against the notifications table added by
-- 027). Granting SELECT to authenticated to make such a policy meaningful
-- would newly expose budget figures to every signed-in user's browser via
-- PostgREST, which is a wider change than intended. Reads go through
-- getSpendReport/lib/budget-revisions.ts like everything else.
-- ---------------------------------------------------------------------------
alter table public.budget_revisions enable row level security;
alter table public.budget_lines enable row level security;

grant all on public.budget_revisions to service_role;
grant all on public.budget_lines to service_role;
grant select on public.v_budget_current to service_role;
