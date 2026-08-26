-- Saved/reusable signatures — lets a signer (BO/CEO/SUPERADMIN, same roles
-- already allowed to write to the "signatures" Storage bucket — see
-- app/api/storage/upload/route.ts's BUCKET_ROLES) upload or draw a
-- signature once and reuse it on future PDF signing
-- (components/shared/PDFSigner.tsx) instead of redrawing on the trackpad
-- every single time.
--
-- One row per email — self-contained/idempotent (CREATE TABLE IF NOT
-- EXISTS), same pattern as 008_announcements.sql / 010_calendar_events.sql,
-- safe to apply regardless of what order migrations land in. `url` points
-- into the existing "signatures" Storage bucket (public, image/png only) —
-- no separate bucket needed for this feature.
CREATE TABLE IF NOT EXISTS saved_signatures (
  email TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
