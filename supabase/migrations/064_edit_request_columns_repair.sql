-- Repair: migration 009's columns never reached the database.
--
-- ===========================================================================
-- 009 IS RECORDED AS APPLIED, LOCALLY AND REMOTELY, BUT ITS COLUMNS DO NOT
-- EXIST. That is why this is a NEW migration rather than re-running 009.
-- ===========================================================================
-- `supabase migration list` shows 009 present on both sides, so `db push`
-- considers it done and will never execute it. Marking it unapplied and
-- re-pushing would rewrite a history that is otherwise correct and is shared
-- with every other environment. A forward-only repair is the safer move, and
-- it is idempotent, so it is harmless if 009 is ever genuinely re-run.
--
-- WHAT WAS ACTUALLY MISSING. Only the five columns. Everything else the
-- edit-request flow touches was verified present before writing this:
-- rejected_by, rejected_stage, reject_reason, rejected_at, resubmit_count,
-- rejection_history, last_resubmitted_at.
--
-- THE STATUS CHECK CONSTRAINT IS ALREADY CORRECT AND IS DELIBERATELY NOT
-- TOUCHED. 009 also recreated requests_status_check to allow 'EDIT_REQUESTED',
-- and that half DID land — because migration 014 later recreated the same
-- constraint with both 'EDIT_REQUESTED' and 'EXPIRED', and 014 ran. Rebuilding
-- it from 009's list here would DROP 'EXPIRED' and orphan the 32 rows that
-- still carry it. Checked before writing; left alone on purpose.
--
-- Its neighbours all landed — 007 (roles.is_auto_registered), 008
-- (announcements), 010 (calendar_events) and 011 (roles.chapter,
-- requests.chapter) are all present. 009 alone did not.
--
-- ROLLBACK (only while the flow is unused — dropping these loses any edit
-- request in flight):
--   alter table requests
--     drop column if exists edit_requested_at,
--     drop column if exists edit_requested_reason,
--     drop column if exists edit_approved_by,
--     drop column if exists edit_approved_at,
--     drop column if exists status_before_edit;

alter table public.requests add column if not exists edit_requested_at timestamptz;
alter table public.requests add column if not exists edit_requested_reason text;
alter table public.requests add column if not exists edit_approved_by text;
alter table public.requests add column if not exists edit_approved_at timestamptz;
alter table public.requests add column if not exists status_before_edit text;

comment on column public.requests.edit_requested_at is
  'Edit Request workflow (migration 009, repaired by 064). Set when an owner asks the current-stage approver for permission to edit; status is deliberately NOT changed until an approver acts.';

do $$
declare
  v_missing text;
begin
  -- Prove the end state rather than trust the DDL above: this migration exists
  -- precisely because a migration once reported success and changed nothing.
  select string_agg(c, ', ') into v_missing
    from (values
      ('edit_requested_at'), ('edit_requested_reason'),
      ('edit_approved_by'), ('edit_approved_at'), ('status_before_edit')
    ) as want(c)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = want.c
   );
  if v_missing is not null then
    raise exception 'ABORT: still missing after this migration: %', v_missing;
  end if;

  -- And that the constraint still accepts every status in live use, including
  -- the two this flow depends on.
  if not exists (
    select 1 from pg_constraint
     where conname = 'requests_status_check'
       and pg_get_constraintdef(oid) like '%EDIT_REQUESTED%'
  ) then
    raise exception 'ABORT: requests_status_check does not allow EDIT_REQUESTED.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'requests_status_check'
       and pg_get_constraintdef(oid) like '%EXPIRED%'
  ) then
    raise exception 'ABORT: requests_status_check no longer allows EXPIRED — 32 live rows carry it.';
  end if;

  raise notice '064: five edit-request columns present; status constraint allows EDIT_REQUESTED and EXPIRED.';
end $$;
