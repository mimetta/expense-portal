-- Deactivation for people. NOT deletion.
--
-- WHY NOT DELETE
--
-- lib/auth.ts auto-registers any @mimetta.co address as EMPLOYEE on sign-in.
-- A deleted person who signs in again is simply re-created, with none of
-- their history and no indication anything happened — so deleting does not
-- revoke access, it only loses the record. And requests, approvals, budget
-- revisions and audit_log all reference the email as plain text with no FK,
-- so the rows would survive pointing at a person who no longer exists.
--
-- Deactivation instead: the roles, scopes and history stay exactly as they
-- are, inert. The person cannot sign in, and disappears from every picker.
--
-- THE CHECK THAT MATTERS is in lib/auth.ts#getCurrentUser, BEFORE
-- auto-registration: a deactivated person is refused, not re-created. If that
-- order is ever reversed, deactivation silently stops working — the person
-- would be recreated as a fresh active EMPLOYEE on their next sign-in.
--
-- SCOPE: this blocks the expense portal only. Disabling someone's Google
-- Workspace account is a separate, and usually more urgent, action.

alter table public.people
  add column if not exists active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by text;

-- Every list and picker filters on this, so it is worth an index even at 38
-- rows: it will be in the hot path of sign-in.
create index if not exists people_active_idx on public.people (active);

comment on column public.people.active is
  'False = cannot sign in and hidden from every picker. Roles/scopes/history are kept untouched. Checked in lib/auth.ts BEFORE auto-registration — see migration 036.';
