-- Revenue goals, by channel, as the denominator the budget is planned against.
--
-- ============================================================================
-- THESE ARE NOT VERSIONED AND NOT APPROVED. THEY TAKE EFFECT IMMEDIATELY.
-- ============================================================================
-- Do NOT assume these follow budget_revisions' DRAFT -> SUBMITTED -> APPROVED
-- workflow (migration 028). A budget is a commitment that someone must sign
-- off, so it is versioned and only an APPROVED revision reaches the spend
-- report. A revenue goal is a target the CEO sets and re-sets; writing one
-- changes what every budget page divides by, the moment it is saved. There is
-- no draft, no submission, no approval, and no history beyond updated_by /
-- updated_at.
--
-- If that ever needs to change, it is a real migration (a revisions table and
-- a "current" view, as 028 did), not a flag added here.
--
-- Goals are typed at CHANNEL level ONLY. Sub-category, category, BU and
-- company figures are sums computed on read, and there is deliberately
-- nowhere to store them: if a total could be typed independently of its
-- parts, the two can disagree, and nothing in the data would say which is
-- right.

create table if not exists public.revenue_channels (
  id uuid primary key default gen_random_uuid(),
  bu text not null,
  category text not null,
  sub_category text not null,
  channel text not null,
  sort_order int not null default 0,
  -- Never delete a channel: revenue_goals cascades from here, so deleting a
  -- closed store would silently remove its historical goals and change last
  -- year's comparison. Closing a store sets active = false.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (bu, category, sub_category, channel)
);

create table if not exists public.revenue_goals (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.revenue_channels(id) on delete cascade,
  fiscal_year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(14,2) not null default 0,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (channel_id, fiscal_year, month)
);

-- The read is always "every goal for this fiscal year", folded per channel.
create index if not exists revenue_goals_year_idx
  on public.revenue_goals (fiscal_year, channel_id);
create index if not exists revenue_channels_bu_idx
  on public.revenue_channels (bu, category, sub_category, sort_order);

-- ABSENCE IS MEANINGFUL HERE, so there is no backfill of zero rows.
-- A month with no row is "not yet open" and renders as an em dash; a row with
-- amount = 0 is a deliberate target of zero. A channel that opens in
-- September has no rows for Jan-Aug, and those months must not read as a
-- target that was missed.

-- RLS per the existing convention: enabled with NO policies, so anon and
-- authenticated reach nothing. Every read and write goes through a Next.js
-- route using the service-role key (lib/supabase/admin.ts), and the
-- CEO/SUPERADMIN-only write rule lives in lib/revenue-goals.ts.
alter table public.revenue_channels enable row level security;
alter table public.revenue_goals enable row level security;

-- The real channel structure. Seeded, not hardcoded in the app: every level
-- is addable from the UI, so a new store is data entry, not a deployment.
-- sort_order keeps the display order stable as channels are added later.
insert into public.revenue_channels (bu, category, sub_category, channel, sort_order)
values
  ('ONEST', 'Physical store', 'Owned store',   'Song Wat',          10),
  ('ONEST', 'Physical store', 'Owned store',   'Talat Noi',         20),
  ('ONEST', 'Physical store', 'Modern Trade',  'Siam Discovery',    10),
  ('ONEST', 'Physical store', 'Modern Trade',  'Vanich House',      20),
  ('ONEST', 'Physical store', 'Modern Trade',  'Loft Eyes',         30),
  ('ONEST', 'Physical store', 'Modern Trade',  'Ecotopia',          40),
  ('ONEST', 'Physical store', 'Modern Trade',  'Gaysorn',           50),
  ('ONEST', 'Physical store', 'Modern Trade',  'Unusual & Friend',  60),
  ('ONEST', 'Physical store', 'Modern Trade',  'Another story',     70),
  ('ONEST', 'Physical store', 'Modern Trade',  'Siplor',            80),
  ('ONEST', 'Physical store', 'Pop-up',        'DCP',               10),
  ('ONEST', 'Online',         'E-commerce',    'Shopee',            10),
  ('ONEST', 'Online',         'E-commerce',    'Lazada',            20),
  ('ONEST', 'Online',         'E-commerce',    'TikTok',            30),
  ('ONEST', 'Online',         'DTC-Thailand',  'LINE Shop',         10),
  ('ONEST', 'Online',         'DTC-Thailand',  'LINE OA',           20),
  ('SV',    'Online',         'E-commerce',    'Shopee',            10),
  ('SV',    'Online',         'E-commerce',    'Lazada',            20),
  ('SV',    'Online',         'E-commerce',    'TikTok',            30),
  ('SV',    'Online',         'DTC-Thailand',  'LINE OA',           10),
  ('SV',    'Online',         'DTC-Thailand',  'Facebook',          20)
on conflict (bu, category, sub_category, channel) do nothing;

-- The two BUs have different trees on purpose — SV is online-only — so the
-- hierarchy is stored per-BU rather than shared.
comment on table public.revenue_channels is
  'Per-BU revenue channel tree (bu > category > sub_category > channel). Addable from the UI; deactivate, never delete. See migration 033.';
comment on table public.revenue_goals is
  'Monthly revenue target per channel. NOT versioned and NOT approved — a write takes effect immediately, unlike budget_revisions. A missing row means "not yet open", not zero. See migration 033.';
