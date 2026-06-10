-- 0006_insights — daily campaign insights pulled from platform reporting (G7).
CREATE TABLE campaign_insights (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  date text NOT NULL,
  spend numeric(14,4) NOT NULL,
  impressions integer NOT NULL,
  clicks integer NOT NULL,
  conversions integer NOT NULL,
  revenue numeric(14,4) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX campaign_insights_day_uq ON campaign_insights(campaign_id, date);
