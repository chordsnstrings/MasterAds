-- 0011_notifications (W5): operator email outbox (FLOW §8.6 "we'll email you
-- when your ads are approved", attention alerts, weekly digest).
CREATE TABLE notifications (
  id text PRIMARY KEY,
  kind text NOT NULL,
  dedup_key text UNIQUE,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX notifications_pending_idx ON notifications (status, created_at);
