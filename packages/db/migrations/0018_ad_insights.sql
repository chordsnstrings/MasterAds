-- 0018 (W12): creatives actually delivered to platforms + per-ad performance.
-- creative_ads maps our creative rows to the platform ad ids created for them;
-- ad_insights stores the per-ad daily metrics those ads report back.
CREATE TABLE creative_ads (
  id text PRIMARY KEY,
  creative_id text NOT NULL REFERENCES creatives(id),
  campaign_id text NOT NULL REFERENCES campaigns(id),
  platform_ad_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, creative_id)
);
CREATE INDEX creative_ads_campaign_idx ON creative_ads (campaign_id);

CREATE TABLE ad_insights (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  creative_id text REFERENCES creatives(id),
  platform_ad_id text NOT NULL,
  date text NOT NULL,
  spend numeric(14,4) NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  revenue numeric(14,4) NOT NULL DEFAULT 0,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_ad_id, date)
);
CREATE INDEX ad_insights_creative_idx ON ad_insights (creative_id, date);
