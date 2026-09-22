-- Reassign wacharanan.j@plantae.co -> wacharanan.j@mimetta.co.
--
-- One person. The address changed at the domain migration and the old one was
-- never swept: it filed 25 requests (Feb-Jul 2026) and approved 86, then the
-- @mimetta.co address picks up in August with no overlapping day between them.
--
-- WHERE THE ADDRESS ACTUALLY LIVES. Every text-ish column of all 36 exposed
-- tables and views was scanned for it (179 columns), plus a substring sweep
-- of every JSONB body, rather than trusting the type definitions:
--
--   requests.bo_approver                        86 rows   <- reassigned here
--   requests.requester_email                    25 rows   <- reassigned here
--   people.email                                 1 row    <- deactivated, not renamed
--   person_roles_employee_snapshot_037.email     1 row    <- left; a record of
--                                                            a row removed by 037
--   audit_log (actor_email and detail_json)      0 rows
--
-- Every other email column was checked and holds none of it: ceo_approver,
-- accounting_user, po_uploaded_by, rejected_by, slip_receiver_email,
-- petty_cash_holder_email, notifications.user_email, budget_revisions'
-- submitted_by/approved_by/created_by, budget_lines, payment_presets,
-- saved_signatures, petty_cash_custodians.
--
-- Two JSONB hits for the string "plantae" are attachment FILENAMES naming the
-- supplier บริษัท แพลนเต้ ไลฟ์ จำกัด (EXP-2026-08-000123, EXP-2026-08-000130),
-- as is payment_presets.name = 'Plantae'. Not this person, not touched.
--
-- audit_log IS DELIBERATELY NOT MODIFIED. It records what happened under the
-- address in use at the time; rewriting it would make the log lie about the
-- past. It happens to hold zero rows for this address, so the rule costs
-- nothing here — it is stated because it is the rule.
--
-- ROLLBACK — ONE STATEMENT:
--
--   update public.requests r
--      set requester_email = coalesce(s.old_requester_email, r.requester_email),
--          bo_approver     = coalesce(s.old_bo_approver,     r.bo_approver)
--     from public.request_email_reassignment_038 s
--    where s.request_id = r.request_id;
--
-- (then, if wanted: update public.people set active = true
--    where email = 'wacharanan.j@plantae.co';)
--
-- The snapshot stores one row per affected request with the ORIGINAL value of
-- each column, null where that column was not the one holding the address —
-- which is why coalesce above restores exactly what was there and nothing else.

create table if not exists public.request_email_reassignment_038 (
  request_id text primary key,
  old_requester_email text,
  old_bo_approver text,
  new_email text not null,
  reassigned_at timestamptz not null default now()
);

insert into public.request_email_reassignment_038
  (request_id, old_requester_email, old_bo_approver, new_email)
select
  request_id,
  case when requester_email = 'wacharanan.j@plantae.co' then requester_email end,
  case when bo_approver     = 'wacharanan.j@plantae.co' then bo_approver     end,
  'wacharanan.j@mimetta.co'
from public.requests
where requester_email = 'wacharanan.j@plantae.co'
   or bo_approver     = 'wacharanan.j@plantae.co'
on conflict (request_id) do nothing;

update public.requests
   set requester_email = 'wacharanan.j@mimetta.co'
 where requester_email = 'wacharanan.j@plantae.co';

update public.requests
   set bo_approver = 'wacharanan.j@mimetta.co'
 where bo_approver = 'wacharanan.j@plantae.co';

-- The old person row stays, deactivated rather than deleted: it holds no
-- operational rows any more, but deleting it would let auth re-create it on a
-- sign-in attempt, and its audit references (none today, but the log is
-- append-only) must keep resolving to a real row.
update public.people
   set active = false,
       deactivated_at = coalesce(deactivated_at, now()),
       deactivated_by = coalesce(deactivated_by, 'migration 038')
 where email = 'wacharanan.j@plantae.co';

alter table public.request_email_reassignment_038 enable row level security;

comment on table public.request_email_reassignment_038 is
  'Pre-image of every requests row whose requester_email or bo_approver was reassigned from wacharanan.j@plantae.co to @mimetta.co by migration 038. Single-statement rollback is in that file''s header.';
