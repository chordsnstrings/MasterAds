-- 0002_coverage — click-ID coverage snapshots (SW §8.7), persisted for the UI.
CREATE TABLE click_id_coverage (
  id text PRIMARY KEY,
  source_site text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('meta','google','tiktok')),
  coverage_pct numeric(6,2) NOT NULL,
  events_total integer NOT NULL,
  events_with_click_id integer NOT NULL,
  window_days integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX click_id_coverage_site_idx ON click_id_coverage(source_site, platform, computed_at);
