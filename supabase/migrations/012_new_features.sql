-- Petty cash custodians, Companies, Drafts, and travel/petty-cash columns on
-- requests (see CLAUDE.md — petty cash custodian workflow, travel expense
-- type, draft feature). Self-contained and idempotent (CREATE TABLE IF NOT
-- EXISTS / ADD COLUMN IF NOT EXISTS), same pattern as every other migration
-- in this project. Not yet applied to the live database as of this writing
-- — apply manually (Supabase SQL editor, or `supabase db push` with real
-- credentials); this agent environment has no SUPABASE_ACCESS_TOKEN.

CREATE TABLE IF NOT EXISTS petty_cash_custodians (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  segment TEXT NOT NULL,
  amount_limit NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  bu TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_th TEXT,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO companies (bu, name_en, name_th, address) VALUES
('ONEST', 'Mimetta Co., Ltd.', 'บริษัท มีเมตตา จำกัด', '591/27, Narasiri Rama II Village, Rama II Road, Samae Dam, Bang Khun Thian, Bangkok 10150'),
('SV', 'S.V. Agriculture Co., Ltd.', NULL, '99/9 Moo 5, Tha Khoei, Suan Phueng, Ratchaburi 70180')
ON CONFLICT (bu) DO NOTHING;

CREATE TABLE IF NOT EXISTS drafts (
  id BIGSERIAL PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT,
  form_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Which company (companies.bu) this expense is billed to — independent of
-- requests.bu, which is the submitting BU's own scope, not necessarily who
-- the expense is billed to.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS use_for_company TEXT;

-- Snapshot of the selected petty_cash_custodians.email at submission time,
-- same "copy, don't join live" convention as requester_name/chapter — see
-- CLAUDE.md.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS petty_cash_holder_email TEXT;

-- Retained for the travel-expense print view but not authoritative — each
-- item's own travel_by/distance_km inside items_json is the source of
-- truth (matching how items_json is already the source of truth for
-- cat_l1/cat_l2/segment over any flat top-level column). This column is a
-- flat convenience copy in case a future report needs to query on it
-- without unpacking items_json.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS travel_items JSONB DEFAULT '[]';

-- New role: PETTY_CASH_CUSTODIAN. roles.role is NOT unrestricted text —
-- 001_initial_schema.sql has a CHECK constraint enumerating the six
-- existing roles — so the new role name needs the same drop-and-recreate
-- treatment 009_edit_request.sql used to add the EDIT_REQUESTED status.
alter table roles drop constraint if exists roles_role_check;
alter table roles add constraint roles_role_check check (role in (
  'SUPERADMIN', 'CEO', 'ACCOUNTING', 'BO', 'PROCUREMENT', 'EMPLOYEE', 'PETTY_CASH_CUSTODIAN'
));
