-- 0017 (W11): brands as workspaces. Each brand carries its own look and its
-- own ad-account connections per platform; campaigns (products) belong to a
-- brand. A NULL brand on a connection means "account-wide default".
CREATE TABLE brands (
  id text PRIMARY KEY,
  name text NOT NULL,
  logo_url text,
  primary_color text,
  tone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN brand_id text REFERENCES brands(id);

ALTER TABLE platform_connections ADD COLUMN brand_id text REFERENCES brands(id);
ALTER TABLE platform_connections DROP CONSTRAINT platform_connections_platform_key;
CREATE UNIQUE INDEX platform_connections_scope_idx
  ON platform_connections (platform, COALESCE(brand_id, ''));
