-- 0008_signal — match-quality signals (W2): client info + Consent Mode v2
-- signals on conversion events, and per-site signal-strength snapshots.
ALTER TABLE conversion_events ADD COLUMN client_info jsonb NOT NULL DEFAULT '{}';
ALTER TABLE conversion_events ADD COLUMN consent_signals jsonb NOT NULL DEFAULT '{}';

CREATE TABLE signal_quality (
  id text PRIMARY KEY,
  source_site text NOT NULL,
  avg_score numeric(5,2) NOT NULL,
  events_total integer NOT NULL,
  window_days integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_quality_site_idx ON signal_quality(source_site, computed_at);
