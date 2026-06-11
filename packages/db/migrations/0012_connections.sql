-- 0012_connections: platform credentials entered through the UI (one row per
-- channel; values never leave the server unmasked). Env vars still take
-- precedence so App Platform-managed secrets keep working unchanged.
CREATE TABLE platform_connections (
  id text PRIMARY KEY,
  platform text NOT NULL UNIQUE
    CHECK (platform IN ('meta','google','tiktok','snapchat','pinterest')),
  credentials jsonb NOT NULL,
  ad_account_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
