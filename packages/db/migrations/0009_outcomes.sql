-- 0009_outcomes (W3): margin-aware value + incrementality experiments.
ALTER TABLE products ADD COLUMN margin_pct numeric(5,2);

CREATE TABLE experiments (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'geo_holdout' CHECK (kind IN ('geo_holdout')),
  platform text,
  test_region text NOT NULL,
  control_region text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','complete')),
  readout jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
