-- Petty cash custodian sign-off — a distinct step from BO_APPROVED (see
-- CLAUDE.md-style note in lib/status.ts#isPettyCashApprovable /
-- app/api/requests/[id]/petty-cash-approve/route.ts). Previously a
-- custodian's approval WAS the BO_APPROVED transition itself
-- (canPettyCashActOnRequest substituting for canBoActOnRequest on the same
-- bo-approve action) — this let a pure custodian's own sign-off silently
-- skip the segment's real BO ever being asked. Splitting it into its own
-- marker column means: a custodian always signs off first (regardless of
-- who submitted the request or whether they hold a BO role too), and the
-- segment's real BO approval (or, if skip_bo is set for that segment, CEO
-- approval directly) is still required afterward — collapsing to one click
-- only when the signing-off user is also an in-scope BO for that request.
--
-- Self-contained/idempotent, same pattern as every other migration in this
-- project (008/010/etc.) — safe to run against a fresh or partially-applied
-- database.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS petty_cash_approved_by TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS petty_cash_approved_at TIMESTAMPTZ;
