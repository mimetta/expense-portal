-- Mimetta Expense Portal — resolve BO cat_l1_scope overlaps by enumeration
--
-- Same snapshot + audit + verify-or-abort pattern as 019 and 020.
--
-- PROBLEM 1 — 13 category lines have two budget owners.
-- wacharanan.j holds `HR Salary` company-wide across six departments; that is
-- intended and their row is NOT touched. But two other BOs hold
-- cat_l1_scope = '*' in departments that also contain an HR Salary line, so
-- both match:
--     siriwan.b  (bu '*', dept COG)   -> 9 ONEST+SV COG HR Salary lines
--     wannisa.p  (bu 'SV', dept R&D)  -> 1 SV R&D HR Salary line
-- Replacing '*' with an explicit list of that department's cat_l1s MINUS
-- 'HR Salary' leaves wacharanan.j as the sole owner of those lines while
-- preserving every other line each BO owns.
--
-- The two lists below were GENERATED from the live `categories` table
-- (distinct cat_l1 per bu_scope/dept_scope, minus HR Salary), not
-- hand-written. Note siriwan.b's bu_scope is '*', so their list is the union
-- across both BUs.
--
-- siriwan.b's SECOND BO row (dept Factory Investment, added by migration 017)
-- keeps cat_l1_scope = '*' deliberately: Factory Investment contains no
-- HR Salary line (its cat_l1s are Building & Construction, Logistic &
-- Warehouse, New Machine, Production Equipment), so there is no collision to
-- resolve and no reason to freeze that scope into a list.
--
-- PROBLEM 2 — 4 Marketing lines have NO owner.
-- Migration 018 created them as ADD_BU_PAIR rows; Marketing's two BOs are
-- scoped per-BU with non-overlapping cat_l1 lists, so each new line landed in
-- the BU whose owner does not list it. Each string below was verified to
-- exist in `categories` for that exact (bu, department) before being written.
--
-- ---------------------------------------------------------------------------
-- KNOWN CONSEQUENCE, stated rather than hidden: replacing '*' with a list
-- narrows coverage to cat_l1 values that EXIST IN CATEGORIES. Three orphan
-- combinations currently matched by siriwan.b's '*' will lose their owner:
--     ONEST / COG / (null)                  -- unresolved MANUAL row
--     SV    / COG / (null)                  -- unresolved MANUAL row
--     ONEST / COG / Factory Operation (OH - COG  -- unresolved typo row
-- All three are already open items in docs/categories-reconciliation.md
-- awaiting a human decision. Adding the malformed typo string to a scope
-- would enshrine it, and a null cat_l1 cannot be matched by any list, so they
-- are left to be fixed at source. scripts/check-bo-coverage.ts (added
-- alongside this migration) exists precisely so enumerated scopes cannot go
-- stale unnoticed.
-- ---------------------------------------------------------------------------

create table if not exists roles_scope_change_2026_08 (
  role_id                uuid primary key references roles (id) on delete cascade,
  email                  text not null,
  bu_scope               text not null,
  dept_scope             text not null,
  cat_l1_scope_original  text not null,
  cat_l1_scope_new       text not null,
  changed_at             timestamptz not null default now()
);

comment on table roles_scope_change_2026_08 is
  'Pre-change cat_l1_scope for every BO row altered by migration 021. Rollback source.';

alter table roles_scope_change_2026_08 enable row level security;
grant all on roles_scope_change_2026_08 to service_role;

do $$
declare
  v_snapshot integer;
  v_updated  integer;
  v_audit    integer;
  v_left     integer;
begin
  -- 1. Snapshot the four rows about to change, keyed on roles.id so the
  --    two siriwan.b BO rows can never be confused.
  insert into roles_scope_change_2026_08 (role_id, email, bu_scope, dept_scope, cat_l1_scope_original, cat_l1_scope_new)
  select r.id, r.email, r.bu_scope, r.dept_scope, r.cat_l1_scope, v.next_scope
    from roles r
    join (values
      -- email, dept_scope selector, new cat_l1_scope
      ('siriwan.b@mimetta.co', 'COG',
       'Direct Labour - COG,Direct Material - COG,Factory Consumable,Factory Operation (OH) - COG,NPD,Raw Materials'),
      ('wannisa.p@mimetta.co', 'R&D',
       'Consumables,Legal & Compliance,Process Dev,Product Dev,RD Other expenses,Regulatory Compliance'),
      ('chawanphat.b@mimetta.co', 'Marketing,Merchandise',
       'Brand Building,CRM & Retention,Infrastructure & Operations,Revenue & Conversion,Supporting Budget,NPD,Replenishing,Marketing Influencer/KOLs,Content Production,E-Commerce'),
      ('akanit.t@mimetta.co', 'Marketing',
       'Affiliate,Brand Material & Packaging Design,CRM,Content Production,E-Commerce,Live,MKT Software & Tools,Marketing Influencer/KOLs,Paid Advertising,Supporting Budget,Website,CRM & Retention')
    ) as v(email, dept_sel, next_scope)
      on v.email = r.email and v.dept_sel = r.dept_scope
   where r.role = 'BO'
     and r.cat_l1_scope is distinct from v.next_scope;
  get diagnostics v_snapshot = row_count;

  -- 2. One audit row per changed scope. request_id is null — this is a role
  --    change, not a request change.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select
    'system@migration',
    null,
    'BO_SCOPE_CHANGED',
    jsonb_build_object(
      'role_id', s.role_id,
      'subject_email', s.email,
      'field', 'cat_l1_scope',
      'bu_scope', s.bu_scope,
      'dept_scope', s.dept_scope,
      'from', s.cat_l1_scope_original,
      'to', s.cat_l1_scope_new,
      'reason', case
        when s.cat_l1_scope_original = '*'
          then 'wildcard replaced with an explicit list (generated from categories, minus HR Salary) so wacharanan.j solely owns the company-wide HR Salary lines'
        else 'extended to cover lines added by migration 018 that would otherwise have no budget owner'
      end,
      'migration', '021_bo_scope_overlaps',
      'rollback_source', 'roles_scope_change_2026_08'
    )
  from roles_scope_change_2026_08 s;
  get diagnostics v_audit = row_count;

  -- 3. Apply, driven off the snapshot so the update cannot diverge from what
  --    was recorded. is_auto_registered is deliberately NOT forced here (that
  --    is PATCH /api/roles/[id]'s behaviour for an admin edit, not a
  --    migration's).
  update roles r
     set cat_l1_scope = s.cat_l1_scope_new
    from roles_scope_change_2026_08 s
   where r.id = s.role_id;
  get diagnostics v_updated = row_count;

  -- 4. Verify or abort.
  if v_snapshot <> 4 then
    raise exception 'ABORT: expected to snapshot 4 BO rows, got %. Scope values may already differ from what this migration assumes.', v_snapshot;
  end if;
  if v_snapshot <> v_updated then
    raise exception 'ABORT: snapshot rows (%) <> updated rows (%).', v_snapshot, v_updated;
  end if;
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit rows (%) <> snapshot rows (%).', v_audit, v_snapshot;
  end if;

  -- No BO other than wacharanan.j may still match an HR Salary line.
  select count(*) into v_left
    from roles r
   where r.role = 'BO'
     and r.email <> 'wacharanan.j@mimetta.co'
     and (r.cat_l1_scope = '*'
          or 'HR Salary' = any (string_to_array(r.cat_l1_scope, ',')))
     and exists (
       select 1 from categories c
        where c.cat_l1 = 'HR Salary'
          and (r.bu_scope = '*' or c.bu = any (string_to_array(r.bu_scope, ',')))
          and (r.dept_scope = '*' or c.department = any (string_to_array(r.dept_scope, ',')))
     );
  if v_left <> 0 then
    raise exception 'ABORT: % BO row(s) other than wacharanan.j still match an HR Salary line.', v_left;
  end if;

  raise notice 'updated % BO scope rows (% snapshot, % audit)', v_updated, v_snapshot, v_audit;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   update roles r
--      set cat_l1_scope = s.cat_l1_scope_original
--     from roles_scope_change_2026_08 s
--    where r.id = s.role_id;
--
--   delete from audit_log where action = 'BO_SCOPE_CHANGED'
--     and detail_json ->> 'migration' = '021_bo_scope_overlaps';
--
--   delete from roles_scope_change_2026_08;
-- ---------------------------------------------------------------------------
