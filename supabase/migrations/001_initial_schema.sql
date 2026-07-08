-- Mimetta Expense Portal — initial schema
-- All application access goes through Next.js API routes using the Supabase
-- service-role key (see lib/supabase/admin.ts). RLS is enabled on every table
-- with no policies granted to anon/authenticated, so direct table access via
-- the public anon/auth keys is denied by default; only the service role
-- (which bypasses RLS) can read/write. Permission and scope logic (roles,
-- BO scoping, dept_config matching) lives in the application layer.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- request_id sequence (per-month counter backing EXP-YYYY-MM-NNNNNN)
-- ---------------------------------------------------------------------------
create table request_id_seq (
  year_month text primary key,
  last_seq integer not null default 0
);

create function generate_request_id() returns text as $$
declare
  ym text := to_char(now(), 'YYYY-MM');
  next_seq integer;
begin
  insert into request_id_seq (year_month, last_seq)
  values (ym, 1)
  on conflict (year_month)
  do update set last_seq = request_id_seq.last_seq + 1
  returning last_seq into next_seq;

  return 'EXP-' || ym || '-' || lpad(next_seq::text, 6, '0');
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- requests
-- ---------------------------------------------------------------------------
create table requests (
  request_id text primary key default generate_request_id(),
  "timestamp" timestamptz not null default now(),

  requester_email text not null,
  requester_name text not null,
  bu text not null check (bu in ('SV', 'ONEST')),

  expense_type text not null,
  urgent_reason text,

  department text not null,
  budget_period text not null, -- YYYY-MM
  product text,
  cat_l1 text,
  cat_l2 text,
  description text,

  amount_net numeric(14, 2) not null,
  vat_rate numeric(5, 2) not null default 0,
  vat_amount numeric(14, 2) not null default 0,
  wht_rate numeric(5, 2) not null default 0,
  wht_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,

  supplier_name text,
  pay_method text,
  bank_name text,
  card_type text,
  pay_ref text,
  credit_term_days integer,
  due_date date,

  status text not null default 'SUBMITTED' check (status in (
    'SUBMITTED', 'PO_UPLOADED', 'BO_APPROVED', 'CEO_APPROVED', 'PAID',
    'REJECTED', 'EXPIRED'
  )),

  files_folder_url text,
  files_json jsonb not null default '[]',

  requires_po boolean not null default true,
  po_number text,
  po_date text,
  po_vendor text,
  po_delivery_date text,
  po_notes text,
  po_uploaded_by text,
  po_uploaded_at timestamptz,

  bo_approver text,
  bo_approved_at timestamptz,

  ceo_approver text,
  ceo_approved_at timestamptz,
  ceo_signature_required boolean,

  accounting_user text,
  paid_at timestamptz,

  rejected_by text,
  rejected_stage text,
  reject_reason text,
  rejected_at timestamptz,
  rejection_history jsonb not null default '[]',
  resubmit_count integer not null default 0,
  last_resubmitted_at timestamptz,

  items_json jsonb not null default '[]',
  items_summary text,
  items_count integer not null default 1,
  product_code text,

  skip_bo boolean not null default false,
  skip_ceo boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requests_status_idx on requests (status);
create index requests_requester_email_idx on requests (requester_email);
create index requests_bu_dept_catl1_idx on requests (bu, department, cat_l1);
create index requests_budget_period_idx on requests (budget_period);

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger requests_set_updated_at
  before update on requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- roles (a user may have multiple rows — always resolve via all_roles array
-- in application code, never a single "primary" role)
-- ---------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in (
    'SUPERADMIN', 'CEO', 'ACCOUNTING', 'BO', 'PROCUREMENT', 'EMPLOYEE'
  )),
  -- comma-separated lists, or '*' for unrestricted. Only meaningful for BO.
  bu_scope text not null default '*',
  dept_scope text not null default '*',
  cat_l1_scope text not null default '*',
  created_at timestamptz not null default now(),
  unique (email, role, bu_scope, dept_scope, cat_l1_scope)
);

create index roles_email_idx on roles (email);

-- ---------------------------------------------------------------------------
-- dept_config (drives skip_bo / skip_ceo / CEO signature requirement,
-- matched score-based on bu + department + cat_l1)
-- ---------------------------------------------------------------------------
create table dept_config (
  id uuid primary key default gen_random_uuid(),
  dept text not null, -- '*' allowed as fallback row
  bu text not null default '*',
  cat_l1 text not null default '*',
  bo_email text,
  exceed_amount numeric(14, 2) not null default 0,
  ceo_signature_required boolean not null default false,
  skip_ceo boolean not null default false,
  skip_bo boolean not null default false,
  created_at timestamptz not null default now()
);

create index dept_config_dept_bu_catl1_idx on dept_config (dept, bu, cat_l1);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  bu text not null,
  department text not null,
  product text,
  cat_l1 text,
  cat_l2 text
);

create index categories_bu_dept_idx on categories (bu, department);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_email text not null,
  request_id text references requests (request_id) on delete set null,
  action text not null,
  detail_json jsonb not null default '{}'
);

create index audit_log_request_id_idx on audit_log (request_id);
create index audit_log_ts_idx on audit_log (ts);

-- ---------------------------------------------------------------------------
-- budget_2026
-- ---------------------------------------------------------------------------
create table budget_2026 (
  id uuid primary key default gen_random_uuid(),
  bu text not null,
  department text not null,
  responsibility text,
  cat_l1 text,
  cat_l2 text,
  jan numeric(14, 2) not null default 0,
  feb numeric(14, 2) not null default 0,
  mar numeric(14, 2) not null default 0,
  apr numeric(14, 2) not null default 0,
  may numeric(14, 2) not null default 0,
  jun numeric(14, 2) not null default 0,
  jul numeric(14, 2) not null default 0,
  aug numeric(14, 2) not null default 0,
  sep numeric(14, 2) not null default 0,
  oct numeric(14, 2) not null default 0,
  nov numeric(14, 2) not null default 0,
  dec numeric(14, 2) not null default 0
);

create index budget_2026_bu_dept_idx on budget_2026 (bu, department);

-- ---------------------------------------------------------------------------
-- revenue
-- ---------------------------------------------------------------------------
create table revenue (
  id uuid primary key default gen_random_uuid(),
  bu text not null,
  year integer not null,
  month text not null,
  amount numeric(14, 2) not null default 0
);

create index revenue_bu_year_idx on revenue (bu, year);

-- ---------------------------------------------------------------------------
-- Row Level Security — default deny for anon/authenticated. All app access
-- goes through server-side API routes using the service-role key.
-- ---------------------------------------------------------------------------
alter table requests enable row level security;
alter table roles enable row level security;
alter table dept_config enable row level security;
alter table categories enable row level security;
alter table audit_log enable row level security;
alter table budget_2026 enable row level security;
alter table revenue enable row level security;
alter table request_id_seq enable row level security;
