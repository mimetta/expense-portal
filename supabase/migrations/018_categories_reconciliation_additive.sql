-- Mimetta Expense Portal — categories reconciliation, part A (additive only)
--
-- Migration A of three. See docs/categories-reconciliation.md for the full
-- plan and the per-row rationale. This migration is ADDITIVE ONLY: it creates
-- one empty table and inserts category rows. It updates nothing and deletes
-- nothing, so it is safe to apply independently of B and C, and reverting it
-- is a delete of exactly the rows it added.
--
-- Part A (this file) : snapshot table + all ADD_CATEGORY / ADD_BU_PAIR rows.
-- Part B             : the REMAP_DEPT updates, which need the rows added here
--                      to already exist so the remapped spend has a line to
--                      land on.
-- Part C             : removes 'Factory' from lib/constants.ts#DEPARTMENTS
--                      (code only, no SQL).
--
-- NOT included, deliberately — see "Leave for now" in the plan doc: the 7
-- MANUAL rows, the `Factory Operation (OH - COG` typo fix, and any
-- cat_l1_scope widening for the four Marketing lines that will become
-- unowned once created. Those are blocked on the HR Salary scope decision.
--
-- ---------------------------------------------------------------------------
-- Snapshot table for migration B.
--
-- Created here, empty, so that B is purely "write rows then update" against a
-- table that already exists — and so that if B is reverted the table can stay
-- as the record of what happened. requests.department has no original-value
-- column of any kind (verified: no department_original, no source_*), so
-- without this the pre-remap value of 367 requests would be unrecoverable.
-- ---------------------------------------------------------------------------
create table if not exists requests_department_remap_2026_08 (
  request_id          text primary key references requests (request_id) on delete cascade,
  department_original text not null,
  department_new      text not null,
  remapped_at         timestamptz not null default now()
);

comment on table requests_department_remap_2026_08 is
  'One row per request whose department was rewritten by migration 019 (categories reconciliation part B). Retained as the rollback source and the only record of the pre-remap value.';

alter table requests_department_remap_2026_08 enable row level security;
grant all on requests_department_remap_2026_08 to service_role;

-- ---------------------------------------------------------------------------
-- Category rows.
--
-- `categories` has NO unique constraint (see CLAUDE.md — bulk import dedupes
-- in application code instead), so every insert below is guarded with NOT
-- EXISTS rather than ON CONFLICT. Re-running this migration is a no-op.
--
-- cat_l2 handling:
--   ADD_BU_PAIR  -> the other BU's cat_l2 lines are duplicated verbatim, so
--                   the two BUs end up with the same shape.
--   ADD_CATEGORY -> no source exists to copy, so a single department-level
--                   row with cat_l2 null. Inventing cat_l2 values would go
--                   beyond the reviewed plan; see the note below on the
--                   cat_l2-level residual this leaves.
--
-- ONE SOURCE ROW IS DELIBERATELY NOT COPIED:
--   ONEST / New Store Investment / Store Design & Construction / "Engineering
-- That cat_l2 begins with a stray double quote — one of five pre-existing
-- values in `categories` corrupted by a CSV import that split on a comma
-- inside a quoted field (the others: "Legal fees (contract review,
-- "POS hardware (tablet, "ภงด 1, "Contracts & IP (e.g. Agreements).
-- Duplicating it would double the corruption. SV therefore gets 2 of the 3
-- Store Design & Construction lines; fix the source value and add the pair
-- together, as a separate cleanup.
-- ---------------------------------------------------------------------------

-- ADD_BU_PAIR — duplicate the other BU's cat_l2 lines verbatim

-- ONEST / Marketing / Marketing Influencer/KOLs  <- copied from SV (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'Marketing', 'Marketing Influencer/KOLs', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'Marketing'
  and cat_l1 = 'Marketing Influencer/KOLs' and cat_l2 is not distinct from null);

-- SV / New Store Investment / Store Design & Construction  <- copied from ONEST (3 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'New Store Investment', 'Store Design & Construction', 'Construction'
where not exists (select 1 from categories where bu = 'SV' and department = 'New Store Investment'
  and cat_l1 = 'Store Design & Construction' and cat_l2 is not distinct from 'Construction');
--   SKIPPED corrupt source cat_l2 "\"Engineering" — see header note
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'New Store Investment', 'Store Design & Construction', 'Store design & architectural fees'
where not exists (select 1 from categories where bu = 'SV' and department = 'New Store Investment'
  and cat_l1 = 'Store Design & Construction' and cat_l2 is not distinct from 'Store design & architectural fees');

-- ONEST / Marketing / Content Production  <- copied from SV (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'Marketing', 'Content Production', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'Marketing'
  and cat_l1 = 'Content Production' and cat_l2 is not distinct from null);

-- SV / Retail / Store Fixed cost  <- copied from ONEST (5 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Store Fixed cost', 'EDC SIM card fee'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Store Fixed cost' and cat_l2 is not distinct from 'EDC SIM card fee');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Store Fixed cost', 'POS software license (initial setup cost)'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Store Fixed cost' and cat_l2 is not distinct from 'POS software license (initial setup cost)');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Store Fixed cost', 'Scent machine'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Store Fixed cost' and cat_l2 is not distinct from 'Scent machine');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Store Fixed cost', 'Software / application (subscriptions used in store)'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Store Fixed cost' and cat_l2 is not distinct from 'Software / application (subscriptions used in store)');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Store Fixed cost', 'Store rental fee'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Store Fixed cost' and cat_l2 is not distinct from 'Store rental fee');

-- SV / Retail / Utilities  <- copied from ONEST (5 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Utilities', 'Electricity'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Utilities' and cat_l2 is not distinct from 'Electricity');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Utilities', 'Water'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Utilities' and cat_l2 is not distinct from 'Water');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Utilities', 'Garbage'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Utilities' and cat_l2 is not distinct from 'Garbage');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Utilities', 'Internet / Wi-Fi'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Utilities' and cat_l2 is not distinct from 'Internet / Wi-Fi');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Utilities', 'Telephone service'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Utilities' and cat_l2 is not distinct from 'Telephone service');

-- SV / Retail / Land and building Taxe  <- copied from ONEST (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'Land and building Taxe', null
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'Land and building Taxe' and cat_l2 is not distinct from null);

-- SV / Retail / In-Store Consumables & Supplies  <- copied from ONEST (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'In-Store Consumables & Supplies', null
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'In-Store Consumables & Supplies' and cat_l2 is not distinct from null);

-- SV / Marketing / CRM & Retention  <- copied from ONEST (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Marketing', 'CRM & Retention', 'CRM Promotion support'
where not exists (select 1 from categories where bu = 'SV' and department = 'Marketing'
  and cat_l1 = 'CRM & Retention' and cat_l2 is not distinct from 'CRM Promotion support');

-- SV / Factory Investment / Production Equipment  <- copied from ONEST (1 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Factory Investment', 'Production Equipment', null
where not exists (select 1 from categories where bu = 'SV' and department = 'Factory Investment'
  and cat_l1 = 'Production Equipment' and cat_l2 is not distinct from null);

-- ONEST / Marketing / E-Commerce  <- copied from SV (2 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'Marketing', 'E-Commerce', 'Marketplace'
where not exists (select 1 from categories where bu = 'ONEST' and department = 'Marketing'
  and cat_l1 = 'E-Commerce' and cat_l2 is not distinct from 'Marketplace');
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'Marketing', 'E-Commerce', 'GWP'
where not exists (select 1 from categories where bu = 'ONEST' and department = 'Marketing'
  and cat_l1 = 'E-Commerce' and cat_l2 is not distinct from 'GWP');

-- SV / Retail / HR Salary  <- copied from ONEST (4 source row(s))
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'HR Salary', 'Staff Benefits'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'HR Salary' and cat_l2 is not distinct from 'Staff Benefits');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'HR Salary', 'Manager'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'HR Salary' and cat_l2 is not distinct from 'Manager');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'HR Salary', 'KAs & Supervisor'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'HR Salary' and cat_l2 is not distinct from 'KAs & Supervisor');
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'Retail', 'HR Salary', 'Retail Commission'
where not exists (select 1 from categories where bu = 'SV' and department = 'Retail'
  and cat_l1 = 'HR Salary' and cat_l2 is not distinct from 'Retail Commission');

-- ADD_CATEGORY — genuinely missing; no source to copy, so department-level (cat_l2 null)

-- SV / General Administrative / EMPLOYEE BENEFITS & WELFARE (Company-Wide)
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'General Administrative', 'EMPLOYEE BENEFITS & WELFARE (Company-Wide)', null
where not exists (select 1 from categories where bu = 'SV' and department = 'General Administrative'
  and cat_l1 = 'EMPLOYEE BENEFITS & WELFARE (Company-Wide)' and cat_l2 is not distinct from null);

-- ONEST / General Administrative / EMPLOYEE BENEFITS & WELFARE (Company-Wide)
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'General Administrative', 'EMPLOYEE BENEFITS & WELFARE (Company-Wide)', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'General Administrative'
  and cat_l1 = 'EMPLOYEE BENEFITS & WELFARE (Company-Wide)' and cat_l2 is not distinct from null);

-- SV / General Administrative / Talent Benefits & Perks
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'General Administrative', 'Talent Benefits & Perks', null
where not exists (select 1 from categories where bu = 'SV' and department = 'General Administrative'
  and cat_l1 = 'Talent Benefits & Perks' and cat_l2 is not distinct from null);

-- ONEST / General Administrative / Talent Benefits & Perks
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'General Administrative', 'Talent Benefits & Perks', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'General Administrative'
  and cat_l1 = 'Talent Benefits & Perks' and cat_l2 is not distinct from null);

-- SV / General Administrative / Software & Tools
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'General Administrative', 'Software & Tools', null
where not exists (select 1 from categories where bu = 'SV' and department = 'General Administrative'
  and cat_l1 = 'Software & Tools' and cat_l2 is not distinct from null);

-- ONEST / General Administrative / Software & Tools
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'General Administrative', 'Software & Tools', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'General Administrative'
  and cat_l1 = 'Software & Tools' and cat_l2 is not distinct from null);

-- SV / R&D / Legal & Compliance
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'R&D', 'Legal & Compliance', null
where not exists (select 1 from categories where bu = 'SV' and department = 'R&D'
  and cat_l1 = 'Legal & Compliance' and cat_l2 is not distinct from null);

-- COG additions pairing with the Factory remaps in migration B

-- SV / COG / Raw Materials
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'COG', 'Raw Materials', null
where not exists (select 1 from categories where bu = 'SV' and department = 'COG'
  and cat_l1 = 'Raw Materials' and cat_l2 is not distinct from null);

-- ONEST / COG / Raw Materials
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'COG', 'Raw Materials', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'COG'
  and cat_l1 = 'Raw Materials' and cat_l2 is not distinct from null);

-- SV / COG / Factory Consumable
insert into categories (bu, department, cat_l1, cat_l2)
select 'SV', 'COG', 'Factory Consumable', null
where not exists (select 1 from categories where bu = 'SV' and department = 'COG'
  and cat_l1 = 'Factory Consumable' and cat_l2 is not distinct from null);

-- ONEST / COG / Factory Consumable
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'COG', 'Factory Consumable', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'COG'
  and cat_l1 = 'Factory Consumable' and cat_l2 is not distinct from null);

-- ONEST / COG / NPD
insert into categories (bu, department, cat_l1, cat_l2)
select 'ONEST', 'COG', 'NPD', null
where not exists (select 1 from categories where bu = 'ONEST' and department = 'COG'
  and cat_l1 = 'NPD' and cat_l2 is not distinct from null);
