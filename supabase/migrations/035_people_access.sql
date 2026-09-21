-- Users & access rebuild, stage 2a: the new shape, ALONGSIDE the old.
--
-- ============================================================================
-- NOTHING READS THESE TABLES YET.
-- ============================================================================
-- `roles` and `settings_tab_permissions` are untouched and remain the only
-- source of truth for every permission decision in the running app. These
-- tables are populated and proven against docs/access-baseline.md in this
-- stage; the switch-over is a later one. If the backfill is wrong, nothing
-- user-facing changes.
--
-- WHAT THIS REPLACES, WHEN THE SWITCH HAPPENS
--
-- `settings_tab_permissions` configures tab access per ROLE, in data. That
-- goes away: role-to-menu defaults move into CODE, and this schema keeps only
-- the EXCEPTIONS, per person, in `person_menu_overrides`. The reason is that a
-- role-level table cannot express "this one accountant also manages suppliers"
-- without widening it for every accountant — which is exactly how DEPT_HEAD
-- ended up granting Products to a person scoped to Retail. Defaults in code
-- are reviewable in a diff; exceptions in data are visible per person.
--
-- Also replaced: the multi-row `roles` table as the carrier of identity (one
-- row per person here, several roles alongside it), and the separate
-- People & departments tab (`people.visible_departments`).
--
-- THE SEVEN ROLES. DEPT_HEAD, PRODUCT_MANAGER and SUPPLIER_MANAGER are retired
-- and deliberately absent from the CHECK below. Their holders keep what they
-- have today through `person_menu_overrides`, written by the backfill.
--
-- BU BELONGS TO THE PERSON, NOT TO BO OWNERSHIP. Today
-- RequestForm#resolvedBu reads bu_scope off ANY role row — including EMPLOYEE,
-- ACCOUNTING and PETTY_CASH_CUSTODIAN rows — to stamp the business unit on
-- every request. Three people resolve to SV from a non-BO row and hold no BO
-- row at all, so a BO-only scope model would silently move them to ONEST. See
-- docs/access-baseline.md.

create table if not exists public.people (
  email text primary key,
  -- 'BOTH' means the person chooses per request; ONEST/SV are fixed.
  bu text not null default 'ONEST' check (bu in ('ONEST', 'SV', 'BOTH')),
  -- True where the value came from resolvedBu's ONEST fallback rather than
  -- from a real bu_scope — so it gets confirmed by a human rather than
  -- silently inherited as if it had been chosen.
  bu_defaulted boolean not null default false,
  -- Spend-report visibility. Comma-separated, '' = nothing (never '*'):
  -- an unassigned person must see nothing. Same convention as roles.department,
  -- which this carries forward.
  visible_departments text not null default '',
  chapter text,
  is_auto_registered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_roles (
  email text not null references public.people (email) on delete cascade,
  role text not null check (role in (
    'SUPERADMIN', 'CEO', 'ACCOUNTING', 'BO', 'PROCUREMENT',
    'PETTY_CASH_CUSTODIAN', 'EMPLOYEE'
  )),
  created_at timestamptz not null default now(),
  primary key (email, role)
);

-- BO ownership only. Same three columns, same comma-and-'*' convention as
-- today's roles table, so lib/permissions.ts#boScopeMatchesRequest is reused
-- UNCHANGED against these rows — the matcher is not reimplemented.
--
-- Several rows per person are OR-ed, exactly as several BO rows are today.
create table if not exists public.bo_scopes (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.people (email) on delete cascade,
  bu_scope text not null default '*',
  dept_scope text not null default '*',
  cat_l1_scope text not null default '*',
  created_at timestamptz not null default now(),
  unique (email, bu_scope, dept_scope, cat_l1_scope)
);

-- EXCEPTIONS ONLY. A person with no row for a menu gets the role default from
-- code. A row means someone deliberately granted (allowed = true) or removed
-- (allowed = false) access the roles would not otherwise give.
--
-- Workflow menus (bo-approvals, ceo-approvals, accounting, procurement,
-- petty-cash) must never appear here: they follow the role and are locked,
-- because opening one without the role shows a page the person cannot act on.
-- That rule lives in code, not in a constraint, since the menu catalogue is
-- a code concern.
create table if not exists public.person_menu_overrides (
  email text not null references public.people (email) on delete cascade,
  menu text not null,
  allowed boolean not null,
  created_at timestamptz not null default now(),
  primary key (email, menu)
);

create index if not exists person_roles_role_idx on public.person_roles (role);
create index if not exists bo_scopes_email_idx on public.bo_scopes (email);

-- Same access model as every other table here: RLS on, no policies, so anon
-- and authenticated reach nothing and all access goes through the service-role
-- key in Next.js routes.
alter table public.people enable row level security;
alter table public.person_roles enable row level security;
alter table public.bo_scopes enable row level security;
alter table public.person_menu_overrides enable row level security;

comment on table public.people is
  'One row per person. Replaces the multi-row roles table as identity. NOT READ BY THE APP YET — see migration 035.';
comment on column public.people.bu is
  'Business unit stamped on this person''s requests. Belongs to the person, not to BO ownership: resolvedBu reads bu_scope off any role row today.';
comment on column public.people.bu_defaulted is
  'True where bu came from the ONEST fallback rather than a real bu_scope. Needs human confirmation.';
comment on table public.bo_scopes is
  'BO approval scope only. Same shape/convention as roles.bu_scope/dept_scope/cat_l1_scope so boScopeMatchesRequest is reused unchanged.';
comment on table public.person_menu_overrides is
  'Exceptions to the role-to-menu defaults in code. Absence means "use the default". Workflow menus never appear here.';
