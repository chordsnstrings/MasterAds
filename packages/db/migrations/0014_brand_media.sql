-- 0014 (W8): per-product branding + owner-uploaded media.
-- Each advertised page can carry its own brand; the global kit is a default.
ALTER TABLE products ADD COLUMN brand_kit jsonb;

CREATE TABLE media_assets (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  mime text NOT NULL,
  data_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_product_idx ON media_assets (product_id);
