-- 0007_channel_keeping — promos as first-class records (G9) and ad-account
-- health state for billing/connection checks and warm-up pacing.
CREATE TABLE promos (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  label text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  expired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promos_active_idx ON promos(expired, ends_at);

CREATE TABLE ad_accounts (
  id text PRIMARY KEY,
  platform text NOT NULL UNIQUE CHECK (platform IN ('meta','google','tiktok')),
  account_ref text,
  platform_created_at timestamptz NOT NULL DEFAULT now(),
  token_valid boolean NOT NULL DEFAULT true,
  billing_ok boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz
);
