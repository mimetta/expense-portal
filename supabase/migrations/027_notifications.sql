-- On-site notification bell (see lib/notifications.ts). Loosely coupled to
-- requests (plain text request_id, no FK) — same convention audit_log
-- already uses, avoids migration-ordering issues.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bell's two main queries: "my unread count" and "my recent list", both
-- filtered by user_email and ordered by recency.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_email, is_read)
  WHERE is_read = false;
