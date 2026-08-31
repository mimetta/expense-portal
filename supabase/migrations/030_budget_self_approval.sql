-- SUPERADMIN may approve a budget revision they submitted themselves. BO and
-- CEO still may not.
--
-- WHY THE CONSTRAINT CANNOT SAY "UNLESS SUPERADMIN"
--
-- 028's constraint was:
--     check (approved_by is null or approved_by <> submitted_by)
--
-- Expressing the exception properly needs the approver's ROLE, which lives in
-- another table. A Postgres CHECK may only reference columns of the row being
-- written — no subqueries, no lookups (it must be immutable, since it is also
-- re-evaluated on validation of existing rows). So "unless that email holds
-- SUPERADMIN" is not expressible here at all. A trigger could do it, but this
-- schema has no triggers anywhere and adding one for this would put an
-- authorisation decision somewhere nobody in this codebase looks.
--
-- WHAT THIS DOES INSTEAD
--
-- Self-approval becomes something a writer must DECLARE, via a new
-- self_approved column, rather than something that can happen silently:
--
--     approved_by is null or approved_by <> submitted_by or self_approved
--
-- plus a second constraint so the flag cannot be set on anything that is not
-- actually a self-approval — the marker shown in /budget/history is only
-- trustworthy if it cannot be applied to a two-person approval.
--
-- BE CLEAR ABOUT WHAT WAS LOST. The database can no longer prove the approver
-- held SUPERADMIN; nothing here can check that. A direct write that sets both
-- approved_by = submitted_by and self_approved = true now succeeds regardless
-- of who the approver is. That check is CODE ONLY, in
-- lib/budget-revisions.ts#approveRevision. What the database still guarantees
-- is narrower but real: an *accidental* or *unmarked* self-approval is still
-- refused, and every self-approval that does happen is recorded as one.

alter table public.budget_revisions
  add column if not exists self_approved boolean not null default false;

comment on column public.budget_revisions.self_approved is
  'True when approved_by = submitted_by. Only a SUPERADMIN may do this, and that part is enforced in lib/budget-revisions.ts, not here — a CHECK cannot look up roles. See migration 030.';

alter table public.budget_revisions
  drop constraint if exists no_self_approval;

-- Unchanged for everyone who has not explicitly declared a self-approval.
alter table public.budget_revisions
  add constraint no_unmarked_self_approval
  check (approved_by is null or approved_by <> submitted_by or self_approved);

-- The flag means exactly one thing and cannot be used to decorate a normal
-- two-person approval.
alter table public.budget_revisions
  add constraint self_approved_is_really_self
  check (
    self_approved = false
    or (approved_by is not null and submitted_by is not null and approved_by = submitted_by)
  );
