-- Mimetta Expense Portal — Budget (Onest Cash Flow) merge
--
-- Ports Onest Cash Flow's P&L (budget vs actual) tool into this project as
-- the "Budget" nav tab, scoped to bu = 'ONEST'. All new tables are prefixed
-- cashflow_ to avoid colliding with this project's own `categories` table
-- and any others.
--
-- NOTE ON SCHEMA ACCURACY: onest-cashflow's core tables (departments,
-- categories, line_items, budget_submissions, users, user_departments)
-- were never checked into that repo as migrations — they were created
-- directly in the Supabase dashboard. The column list below is
-- reconstructed from src/types/index.ts and the columns actually selected
-- in src/lib/pl-data.ts in that repo, which should be complete, but there
-- is no committed source of truth to diff against. Before running this
-- against production, pull the live schema from the OLD onest-cashflow
-- Supabase project (`supabase db pull` or Studio → Database → Schema
-- Visualizer) and confirm every column here is accounted for — especially
-- any nullable/default that mattered for existing rows.
--
-- Run order: this file assumes 001-013 already applied.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- cashflow_departments / cashflow_categories / cashflow_line_items
-- (was: departments / categories / line_items in onest-cashflow)
-- ---------------------------------------------------------------------------
create table cashflow_departments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  full_name text not null,
  owner_name text,
  created_at timestamptz not null default now(),
  unique (code, full_name)
);

create table cashflow_categories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references cashflow_departments (id) on delete cascade,
  code text,
  name text not null,
  is_hr_category boolean not null default false,
  cogm_group text check (cogm_group in ('DM', 'DL', 'MOH')),
  capex_group text,
  owner_name text,
  created_at timestamptz not null default now()
);

create index cashflow_categories_dept_idx on cashflow_categories (department_id);

create table cashflow_line_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cashflow_categories (id) on delete cascade,
  name text not null,
  subcategory_l1 text,
  owner_name text,
  type text not null check (type in ('REVENUE', 'EXPENSE')),
  phase2_auto boolean not null default false,
  created_at timestamptz not null default now()
);

create index cashflow_line_items_category_idx on cashflow_line_items (category_id);

-- ---------------------------------------------------------------------------
-- cashflow_budget_submissions (was: budget_submissions)
-- The "goal" side — still entered manually by dept heads / imported by
-- admin, exactly as it worked in Onest Cash Flow.
-- ---------------------------------------------------------------------------
create table cashflow_budget_submissions (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references cashflow_line_items (id) on delete cascade,
  department_id uuid not null references cashflow_departments (id) on delete cascade,
  submitted_by text not null,
  month date not null,
  amount numeric(15, 2) not null default 0,
  note text,
  status text not null default 'submitted' check (status in (
    'draft', 'submitted', 'approved', 'rejected'
  )),
  version integer not null default 1,
  visible_to_ceo boolean not null default false,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_item_id, month)
);

create index cashflow_budget_submissions_month_idx on cashflow_budget_submissions (month);

-- ---------------------------------------------------------------------------
-- cashflow_line_item_map — the piece that didn't exist before.
-- Maps this project's free-text (department, cat_l1, cat_l2) on `requests`
-- to a specific cashflow_line_items row, so a PAID Onest request knows
-- which P&L line it belongs to.
-- ---------------------------------------------------------------------------
create table cashflow_line_item_map (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  cat_l1 text,
  cat_l2 text,
  line_item_id uuid not null references cashflow_line_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (department, cat_l1, cat_l2)
);

-- ---------------------------------------------------------------------------
-- cashflow_actuals — replaces onest-cashflow's manually-entered `expenses`
-- table. This view IS the "actual" data now: it lives-sums every PAID
-- ONEST request through the mapping table, grouped by the month the
-- request was submitted (budget_period), per your "goal vs actual" call.
-- No row is ever written here by a human — nothing to keep in sync.
-- ---------------------------------------------------------------------------
create view cashflow_actuals as
select
  m.line_item_id,
  (r.budget_period || '-01')::date as month,
  sum(r.total) as amount
from requests r
join cashflow_line_item_map m
  on m.department = r.department
  and coalesce(m.cat_l1, '') = coalesce(r.cat_l1, '')
  and coalesce(m.cat_l2, '') = coalesce(r.cat_l2, '')
where r.bu = 'ONEST' and r.status = 'PAID'
group by m.line_item_id, r.budget_period;

-- ---------------------------------------------------------------------------
-- New role: DEPT_HEAD. Reuses the existing dept_scope column on `roles`
-- (same mechanism BO already uses) to limit a dept head to their own
-- department's line items on the Budget page.
-- ---------------------------------------------------------------------------
alter table roles drop constraint roles_role_check;
alter table roles add constraint roles_role_check check (role in (
  'SUPERADMIN', 'CEO', 'ACCOUNTING', 'BO', 'PROCUREMENT', 'EMPLOYEE',
  'PETTY_CASH_CUSTODIAN', 'DEPT_HEAD'
));

-- ---------------------------------------------------------------------------
-- RLS — same default-deny pattern as every other table in this project.
-- Only the service-role key (server-side API routes) can read/write.
-- ---------------------------------------------------------------------------
alter table cashflow_departments enable row level security;
alter table cashflow_categories enable row level security;
alter table cashflow_line_items enable row level security;
alter table cashflow_budget_submissions enable row level security;
alter table cashflow_line_item_map enable row level security;

-- ---------------------------------------------------------------------------
-- Seed data — ported from onest-cashflow/step3_seed_final.sql (20
-- departments, 104 categories, 214 line items). Table names renamed to the
-- cashflow_ prefix; content is otherwise unchanged from the old platform.
-- ---------------------------------------------------------------------------
-- 2. Departments (20 rows)
-- ─────────────────────────────────────────────────────────────
INSERT INTO cashflow_departments (code, full_name) VALUES
  ('Revenue by Channel', 'PHYSICAL STOERS'),
  ('Revenue by Channel', 'ONLINE CHANNELS'),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS'),
  ('Revenue by Channel', 'REGIONAL CHANNELS'),
  ('Revenue by Product Category', 'PERSONAL CARE'),
  ('Revenue by Product Category', 'HOME CARE'),
  ('Revenue by Product Category', 'GIFT SETS & SEASONAL'),
  ('Revenue by Product Category', 'MERCHANDISE'),
  ('GP', 'Gross profit (% fee)'),
  ('COGM', 'Cost of Goods Manufactured'),
  ('COGS', 'Cost of Goods Sold'),
  ('Factory Operation', 'Factory Operation'),
  ('OEM', 'Original Equipment Manufacturer'),
  ('Merchandise', 'Merchandise'),
  ('MKT & SALES', 'MARKETING & SALES'),
  ('Retail Operations', 'Retail Operations'),
  ('R&D', 'RESEARCH & DEVELOPMENT'),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT'),
  ('G&A', 'GENERAL & ADMINISTRATIVE'),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. Categories (104 rows)
-- ─────────────────────────────────────────────────────────────
INSERT INTO cashflow_categories (department_id, name, is_hr_category)
SELECT d.id, v.cat_name, v.is_hr
FROM (VALUES
  ('Revenue by Channel', 'PHYSICAL STOERS', 'own Stores Thailand', false::boolean),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Pop-up & Limited Time Stores (with KA)', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Modern Trade', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'E-commerce Platforms - Thailand', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'Online DTC - Thailand', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Corporate Gifting & Custom Orders', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Hotel Amenities Programs', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Events (Markets/Festivals/Private)', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Singapore', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Taiwan', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Hong Kong', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'E-commerce Platforms - Regional', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Hand Wash', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Satin Veil Body Lotion', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Body Cleanser', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Hand Cream', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Body & Hair Fragrance Mist', false),
  ('Revenue by Product Category', 'HOME CARE', 'Ambient Parfum', false),
  ('Revenue by Product Category', 'HOME CARE', 'Ambient Diffuser', false),
  ('Revenue by Product Category', 'HOME CARE', 'Fabric Fragrance', false),
  ('Revenue by Product Category', 'HOME CARE', 'Surface Cleaner', false),
  ('Revenue by Product Category', 'HOME CARE', 'Dish Soap', false),
  ('Revenue by Product Category', 'HOME CARE', 'Blooming', false),
  ('Revenue by Product Category', 'HOME CARE', 'Wood Cleanser', false),
  ('Revenue by Product Category', 'HOME CARE', 'Wood Oil', false),
  ('Revenue by Product Category', 'HOME CARE', 'Dry Wool Wash', false),
  ('Revenue by Product Category', 'GIFT SETS & SEASONAL', 'GIFT SETS & SEASONAL', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Kindness Tote Bag', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Stay Kind Cap', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Kindness Carryall', false),
  ('GP', 'Gross profit (% fee)', 'Shopee TH GP (12-15%)', false),
  ('GP', 'Gross profit (% fee)', 'Lazada GP (15-18%)', false),
  ('GP', 'Gross profit (% fee)', 'TikTok Shop commission (5%)', false),
  ('GP', 'Gross profit (% fee)', 'Shopee Regional GP (15-20%)', false),
  ('GP', 'Gross profit (% fee)', 'Siam Discovery GP (25%)', false),
  ('GP', 'Gross profit (% fee)', 'Loft Eyes GP (7k + 15%)', false),
  ('GP', 'Gross profit (% fee)', 'Gaysorn GP (30%)', false),
  ('GP', 'Gross profit (% fee)', 'Nextopia (Ecotopia) GP (25%)', false),
  ('COGM', 'Cost of Goods Manufactured', 'Raw Materials', false),
  ('COGM', 'Cost of Goods Manufactured', 'Packaging', false),
  ('COGM', 'Cost of Goods Manufactured', 'NPD-Raw Materials', false),
  ('COGM', 'Cost of Goods Manufactured', 'NPD-Packaging', false),
  ('COGM', 'Cost of Goods Manufactured', 'Factory Labor (HR-COG)', false),
  ('COGS', 'Cost of Goods Sold', 'Cost of Goods Sold', false),
  ('Factory Operation', 'Factory Operation', 'Factory Consumable', false),
  ('Factory Operation', 'Factory Operation', 'Factory Maintenance', false),
  ('Factory Operation', 'Factory Operation', 'Factory Electricity', false),
  ('Factory Operation', 'Factory Operation', 'Factory Water', false),
  ('Factory Operation', 'Factory Operation', 'Factory Internet/Phone', false),
  ('Factory Operation', 'Factory Operation', 'Factory Rental', false),
  ('Factory Operation', 'Factory Operation', 'Quality Control', false),
  ('Factory Operation', 'Factory Operation', 'Pest Control', false),
  ('Factory Operation', 'Factory Operation', 'Factory Fire Insurance', false),
  ('Factory Operation', 'Factory Operation', 'Factory Maid', false),
  ('Factory Operation', 'Factory Operation', 'Security Guard Service', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', true),
  ('OEM', 'Original Equipment Manufacturer', 'OEM Service fee', false),
  ('OEM', 'Original Equipment Manufacturer', 'Replenishing', false),
  ('OEM', 'Original Equipment Manufacturer', 'NPD', false),
  ('Merchandise', 'Merchandise', 'Replenishing', false),
  ('Merchandise', 'Merchandise', 'NPD', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', false),
  ('MKT & SALES', 'MARKETING & SALES', 'CRM & Retention', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Supporting Budget', false),
  ('MKT & SALES', 'MARKETING & SALES', 'HR Salary', true),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', false),
  ('Retail Operations', 'Retail Operations', 'Maintenance & Repairs', false),
  ('Retail Operations', 'Retail Operations', 'In-Store Consumables & Supplies', false),
  ('Retail Operations', 'Retail Operations', 'Insurance', false),
  ('Retail Operations', 'Retail Operations', 'Land and building Taxe', false),
  ('Retail Operations', 'Retail Operations', 'Signboard Taxe', false),
  ('Retail Operations', 'Retail Operations', 'Media & Materials', false),
  ('Retail Operations', 'Retail Operations', 'Retail ค่าเดินทาง', false),
  ('Retail Operations', 'Retail Operations', 'KAs & Supervisor', false),
  ('Retail Operations', 'Retail Operations', 'Retail Commission', false),
  ('Retail Operations', 'Retail Operations', 'Benefits', false),
  ('Retail Operations', 'Retail Operations', 'HR Salary', true),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Regulatory Compliance', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Process Dev', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Consumables', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'RD Other expenses', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'HR Salary', true),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse & Inventory', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistics & Shipping', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Maintenance', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Software', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'OPS&FF ค่าเดินทาง', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse Labor (picking, packing) (HR)', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Stock Staff (HR)', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistic Staff (HR)', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'HR Salary', true),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', true),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Salary', true),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', true),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Finance & Accounting', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Legal & Compliance', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Other Miscellaneous', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'TAXES', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'Factory Investment', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', false)
) AS v(dept_code, dept_full_name, cat_name, is_hr)
JOIN cashflow_departments d ON d.code = v.dept_code AND d.full_name = v.dept_full_name
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. Line items (214 rows)
-- ─────────────────────────────────────────────────────────────
INSERT INTO cashflow_line_items (category_id, name, subcategory_l1, owner_name, type, phase2_auto)
SELECT c.id, v.name, v.subcategory_l1, v.owner, v.type, v.phase2_auto
FROM (VALUES
  ('Revenue by Channel', 'PHYSICAL STOERS', 'own Stores Thailand', 'Song Wat', NULL::text, NULL::text, 'REVENUE', false::boolean),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'own Stores Thailand', 'Talat Noi', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Pop-up & Limited Time Stores (with KA)', 'Dusit Central Park', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Pop-up & Limited Time Stores (with KA)', 'Siam Discovery', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Modern Trade', 'Vanich House', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Modern Trade', 'Loft Eyes', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Modern Trade', 'Ecotopia', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'PHYSICAL STOERS', 'Modern Trade', 'Gaysorn', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'E-commerce Platforms - Thailand', 'Shopee', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'E-commerce Platforms - Thailand', 'Lazada', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'E-commerce Platforms - Thailand', 'Tiktok', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'Online DTC - Thailand', 'LINE OA', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'ONLINE CHANNELS', 'Online DTC - Thailand', 'LINE Shopping', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Corporate Gifting & Custom Orders', 'Corporate Gifting & Custom Orders', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Hotel Amenities Programs', 'Hotel Amenities Programs', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'B2B, PARTNERSHIPS & EVENTS', 'Events (Markets/Festivals/Private)', 'Events (Markets/Festivals/Private)', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Singapore', 'Singapore', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Taiwan', 'Taiwan', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'Hong Kong', 'Hong Kong', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'E-commerce Platforms - Regional', 'Website International', NULL, NULL, 'REVENUE', false),
  ('Revenue by Channel', 'REGIONAL CHANNELS', 'E-commerce Platforms - Regional', 'Shopee Regional', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Hand Wash', 'Hand Wash', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Satin Veil Body Lotion', 'Satin Veil Body Lotion', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Body Cleanser', 'Body Cleanser', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Hand Cream', 'Hand Cream', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'PERSONAL CARE', 'Body & Hair Fragrance Mist', 'Body & Hair Fragrance Mist', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Ambient Parfum', 'Ambient Parfum', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Ambient Diffuser', 'Ambient Diffuser', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Fabric Fragrance', 'Fabric Fragrance', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Surface Cleaner', 'Surface Cleaner', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Dish Soap', 'Dish Soap', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Blooming', 'Blooming', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Wood Cleanser', 'Wood Cleanser', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Wood Oil', 'Wood Oil', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'HOME CARE', 'Dry Wool Wash', 'Dry Wool Wash', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'GIFT SETS & SEASONAL', 'GIFT SETS & SEASONAL', 'GIFT SETS & SEASONAL', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Kindness Tote Bag', 'Kindness Tote Bag', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Stay Kind Cap', 'Stay Kind Cap', NULL, NULL, 'REVENUE', false),
  ('Revenue by Product Category', 'MERCHANDISE', 'Kindness Carryall', 'Kindness Carryall', NULL, NULL, 'REVENUE', false),
  ('GP', 'Gross profit (% fee)', 'Shopee TH GP (12-15%)', 'Shopee TH GP (12-15%)', NULL, 'PIM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Lazada GP (15-18%)', 'Lazada GP (15-18%)', NULL, 'PIM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'TikTok Shop commission (5%)', 'TikTok Shop commission (5%)', NULL, 'PIM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Shopee Regional GP (15-20%)', 'Shopee Regional GP (15-20%)', NULL, 'PIM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Siam Discovery GP (25%)', 'Siam Discovery GP (25%)', NULL, 'PIMM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Loft Eyes GP (7k + 15%)', 'Loft Eyes GP (7k + 15%)', NULL, 'PIMM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Gaysorn GP (30%)', 'Gaysorn GP (30%)', NULL, 'PIMM', 'EXPENSE', false),
  ('GP', 'Gross profit (% fee)', 'Nextopia (Ecotopia) GP (25%)', 'Nextopia (Ecotopia) GP (25%)', NULL, 'PIMM', 'EXPENSE', false),
  ('COGM', 'Cost of Goods Manufactured', 'Raw Materials', 'Raw Materials', NULL, 'KWANG SI', 'EXPENSE', false),
  ('COGM', 'Cost of Goods Manufactured', 'Packaging', 'Packaging', NULL, 'KWANG SI', 'EXPENSE', false),
  ('COGM', 'Cost of Goods Manufactured', 'NPD-Raw Materials', 'NPD-Raw Materials', NULL, 'KWANG SI', 'EXPENSE', false),
  ('COGM', 'Cost of Goods Manufactured', 'NPD-Packaging', 'NPD-Packaging', NULL, 'KWANG SI', 'EXPENSE', false),
  ('COGM', 'Cost of Goods Manufactured', 'Factory Labor (HR-COG)', 'Factory Labor (HR-COG)', NULL, 'KWANG SI', 'EXPENSE', false),
  ('COGS', 'Cost of Goods Sold', 'Cost of Goods Sold', 'Cost of Goods Sold', NULL, 'KWANG SI', 'EXPENSE', true),
  ('Factory Operation', 'Factory Operation', 'Factory Consumable', 'Factory Consumable', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Maintenance', 'Factory Maintenance', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Electricity', 'Factory Electricity', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Water', 'Factory Water', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Internet/Phone', 'Factory Internet/Phone', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Rental', 'Factory Rental', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Quality Control', 'Quality Control', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Pest Control', 'Pest Control', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Fire Insurance', 'Factory Fire Insurance', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Factory Maid', 'Factory Maid', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'Security Guard Service', 'Security Guard Service', NULL, 'SA', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', 'Factory เบี้ยขยัน', NULL, 'FIRST', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', 'Quarterly Factory Worker Gathering', NULL, 'FIRST', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', 'New Year Party', NULL, 'FIRST', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', 'Factory ทุนการศึกษาบุตร', NULL, 'FIRST', 'EXPENSE', false),
  ('Factory Operation', 'Factory Operation', 'HR Salary', 'Factory ทุนการศึกษาพนักงาน', NULL, 'FIRST', 'EXPENSE', false),
  ('OEM', 'Original Equipment Manufacturer', 'OEM Service fee', 'OEM Service fee', NULL, 'MEW', 'EXPENSE', false),
  ('OEM', 'Original Equipment Manufacturer', 'Replenishing', 'Raw Materials', NULL, 'PIN', 'EXPENSE', false),
  ('OEM', 'Original Equipment Manufacturer', 'Replenishing', 'Packaging', NULL, 'PIN', 'EXPENSE', false),
  ('OEM', 'Original Equipment Manufacturer', 'NPD', 'Raw Materials', NULL, 'MEW', 'EXPENSE', false),
  ('OEM', 'Original Equipment Manufacturer', 'NPD', 'Packaging', NULL, 'MEW', 'EXPENSE', false),
  ('Merchandise', 'Merchandise', 'Replenishing', 'Replenishing', NULL, 'PIN', 'EXPENSE', false),
  ('Merchandise', 'Merchandise', 'NPD', 'NPD', NULL, 'MEW', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Instagram ads', NULL, 'PHANTA', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Content Production', NULL, 'SAFE', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Event (Offline Campaign)', NULL, 'ELLIE', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Collab with Other Brands', NULL, 'ELLIE', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Sponsor (brand)', NULL, 'PLEUM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'PR / Media Exposure / Gifting', NULL, 'PLEUM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Marketing Influencer / KOL', NULL, 'PLEUM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Store Decoration', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Store MKT Activity', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Brand Building', 'Brand Material & Packaging', NULL, 'PING', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Shopee In-App Ads', NULL, 'PHANTA', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Shopee CPAS Ads', NULL, 'PHANTA', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Tiktok Ads', NULL, 'PHANTA', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Marketplace Campaign', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Affiliate', NULL, 'PLEUM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Live', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'Website', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Revenue & Conversion', 'E-Commerce Promotion Support', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'CRM & Retention', 'CRM Promotion support', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', 'LINE OA', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', 'Adobe (Yearly)', NULL, 'OIL', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', 'Capcut (Yearly)', NULL, 'SAFE', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', 'Freepik (Yearly)', NULL, 'OIL', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Infrastructure & Operations', 'Unsplash (Yearly)', NULL, 'OIL', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Supporting Budget', 'MKT ค่าเดินทาง', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'Supporting Budget', 'MKT ค่าที่พัก', NULL, 'PIM', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'HR Salary', 'Marketing Salaries (HR-MKT)', NULL, 'FIRST', 'EXPENSE', false),
  ('MKT & SALES', 'MARKETING & SALES', 'HR Salary', 'Marketing Commission', NULL, 'FIRST', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', 'Store rental fee', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', 'POS software license (initial setup cost)', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', 'EDC SIM card fee', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', 'Scent machine', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Store Fixed cost', 'Software / application subscriptions used in store', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', 'Electricity', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', 'Water', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', 'Garbage', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', 'Internet / Wi-Fi', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Utilities', 'Telephone service', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Maintenance & Repairs', 'Maintenance & Repairs', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'In-Store Consumables & Supplies', 'In-Store Consumables & Supplies', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Insurance', 'Insurance', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Land and building Taxe', 'Land and building Taxe', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Signboard Taxe', 'Signboard Taxe', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Media & Materials', 'Media & Materials', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Retail ค่าเดินทาง', 'Retail ค่าเดินทาง', NULL, 'PIMM', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'KAs & Supervisor', 'KAs & Supervisor', NULL, 'FIRST', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Retail Commission', 'Retail Commission', NULL, 'FIRST', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'Benefits', 'Benefits', NULL, 'FIRST', 'EXPENSE', false),
  ('Retail Operations', 'Retail Operations', 'HR Salary', 'Manager', NULL, 'FIRST', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'RM/PKG Testing', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'Product Sample', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'OEM dev', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'Stability & Compatability Testing', NULL, 'NUK', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'Safety and Efficacy Testing (Lab)', NULL, 'NUK', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Product Dev', 'Internal / External Testing', NULL, 'NUK', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Regulatory Compliance', 'Regulatory submissions (e.g. อ.ย.)', NULL, 'NUENG', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Regulatory Compliance', 'Label claims validation (for commercial)', NULL, 'NUENG', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Process Dev', 'Trial batch', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Process Dev', 'Pilot batch', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Process Dev', 'Scale-up batch', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'Consumables', 'Consumables', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'RD Other expenses', 'RD ค่าเดินทาง', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'RD Other expenses', 'RD ค่าที่พัก', NULL, 'PEEM', 'EXPENSE', false),
  ('R&D', 'RESEARCH & DEVELOPMENT', 'HR Salary', 'R&D Salaries (HR-RD)', NULL, 'FIRST', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse & Inventory', 'Warehouse Eletricity', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse & Inventory', 'Warehouse Water', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse & Inventory', 'Warehouse Internet', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistics & Shipping', 'Shipping & Delivery (Thailand)', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistics & Shipping', 'Shipping & Delivery (Regional)', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistics & Shipping', 'Packaging Materials (Shipping boxes, tape)', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistics & Shipping', 'Returns Handling', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Maintenance', 'Maintenance', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Software', 'Software', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'OPS&FF ค่าเดินทาง', 'OPS&FF ค่าเดินทาง', NULL, 'BIG', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Warehouse Labor (picking, packing) (HR)', 'Warehouse Labor (picking, packing) (HR)', NULL, 'FIRST', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Stock Staff (HR)', 'Stock Staff (HR)', NULL, 'FIRST', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'Logistic Staff (HR)', 'Logistic Staff (HR)', NULL, 'FIRST', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'HR Salary', 'Production Management Salaries (HR-COG Mgmt)', NULL, 'FIRST', 'EXPENSE', false),
  ('OPS & FF', 'OPERATIONS & FULFILLMENT', 'HR Salary', 'Sourcing & Procure Team', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Rent', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Utilities (Water/Electric/Internet)', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Supplies', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Phone Package', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Cleaning', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Office Equipment Rental (copier)', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'IT Equipment (laptop for new hire)', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Equipment Maintenance', 'Office & Facilities', 'KLAO', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Google Workspace', 'Software & Tools', 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Discord', 'Software & Tools', 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'AI (Claude+ChatGPT)', 'Software & Tools', 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Supabase', 'Software & Tools', 'NOON', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'GoDaddy', 'Software & Tools', 'NOON', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'AccCloud', 'Software & Tools', 'NOON', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Empeo', 'Software & Tools', 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Asana', 'Software & Tools', 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'HR ค่าเดินทาง (ทีมกลาง)', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Operation', 'Recruitment', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Salary', 'Accounting Team', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Salary', 'People & System Team', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Yearly Bonus', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Employee Meals (BKK - lunch)', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Employee Snacks & Coffee', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Employee Meals (Factory - lunch)', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Health Insurance', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Company Outing', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Monthly Meeting', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Self-Care retreat', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'ตรวจสุขภาพประจำปี', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'L&D Training', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'HR Benefits', 'Upskill & Grow Wallet [HRD]', NULL, 'FIRST', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Finance & Accounting', 'Bookkeeping Services', NULL, 'YING', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Finance & Accounting', 'Audit Fees', NULL, 'YING', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Legal & Compliance', 'Legal Counsel', NULL, 'NUENG', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Legal & Compliance', 'Licenses & Permits', NULL, 'NUENG', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Legal & Compliance', 'Contracts & IP', NULL, 'NUENG', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Other Miscellaneous', 'ค่าดำเนินการเอกสารบริษัท', NULL, 'YING', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'Other Miscellaneous', 'อื่นๆ', NULL, 'YING', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'TAXES', 'ภพ30', NULL, 'YING', 'EXPENSE', false),
  ('G&A', 'GENERAL & ADMINISTRATIVE', 'TAXES', 'ภงด 1,3,53,ภพ36', NULL, 'YING', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'Factory Investment', 'New Machine', NULL, 'KWANG SI', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'Factory Investment', 'Production Equipment', NULL, 'KWANG SI', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'Factory Investment', 'Building & Construction', NULL, 'KWANG SI', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'Factory Investment', 'Logistic & Warehouse', NULL, 'KWANG SI', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Store design & architectural fees', 'Store Design & Construction', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Construction', 'Store Design & Construction', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Engineering, electrical, plumbing setup', 'Store Design & Construction', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Rental deposit', 'Deposits & Legal Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Legal fees (contract review, permits)', 'Deposits & Legal Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'License and permit application fees', 'Deposits & Legal Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'POS hardware (tablet, cash drawer, printer, scanner)', 'POS & Technology Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Router/network equipment', 'POS & Technology Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'CCTV installation (initial cost)', 'POS & Technology Setup', 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Store Fixtures & Equipment', NULL, 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Store Decoration & Branding', NULL, 'PORT', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Measurement & Analysis Instruments', 'Lab Instrument Investment (RD)', 'PEEM', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Equipment for Sample Preparation & Cultivation', 'Lab Instrument Investment (RD)', 'PEEM', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Weighing Instruments', 'Lab Instrument Investment (RD)', 'PEEM', 'EXPENSE', false),
  ('Depreciation & CAPEX', 'Depreciation & CAPEX', 'New Store Investment', 'Small Equipment/Tools', 'Lab Instrument Investment (RD)', 'PEEM', 'EXPENSE', false)
) AS v(dept_code, dept_full_name, cat_name, name, subcategory_l1, owner, type, phase2_auto)
JOIN cashflow_departments d ON d.code = v.dept_code AND d.full_name = v.dept_full_name
JOIN cashflow_categories  c ON c.department_id = d.id AND c.name = v.cat_name
ON CONFLICT DO NOTHING;

