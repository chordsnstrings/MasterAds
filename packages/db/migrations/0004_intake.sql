-- 0004_intake — intake jobs (async "reading…" status for the UI), connected
-- feed sources, and typed product change events emitted by feed sync (G4),
-- consumed by channel-keeping automations (G9).

CREATE TABLE intake_jobs (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('url','text','file')),
  input text NOT NULL,
  status text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','done','unreadable')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feed_sources (
  id text PRIMARY KEY,
  ref text NOT NULL,
  label text,
  catalog_group_id text NOT NULL,
  sync_interval_hours integer NOT NULL DEFAULT 4,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_change_events (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('price_change','stock_out','back_in_stock','new_product')),
  before jsonb,
  after jsonb,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_change_unprocessed_idx ON product_change_events(processed, created_at);
