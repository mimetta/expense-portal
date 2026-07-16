-- "Let Procurement fill payment details" toggle on /submit (see CLAUDE.md
-- Payment Details section) — self-contained/idempotent, same pattern as
-- every other migration in this project. Not yet applied to the live
-- database as of this writing; apply manually (Supabase SQL editor, or
-- `supabase db push` with real credentials) — this agent environment has
-- no SUPABASE_ACCESS_TOKEN.

ALTER TABLE requests ADD COLUMN IF NOT EXISTS procurement_fills_payment BOOLEAN DEFAULT FALSE;
