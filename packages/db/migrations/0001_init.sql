-- 0001_init — full Phase One core schema (SW §6).
-- Forward-only: this file is immutable once committed; changes are new files.

CREATE TABLE products (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('catalog','offer')),
  vertical text,
  source_ref text,
  title text NOT NULL,
  description text,
  price numeric(14,4),
  currency text,
  url text,
  images jsonb NOT NULL DEFAULT '[]',
  category text,
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('in_stock','out_of_stock','unknown')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','launching','learning','autonomous','needs_attention','paused')),
  catalog_group_id text,
  raw_input text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playbooks (
  id text PRIMARY KEY,
  vertical text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  objective text NOT NULL,
  funnel_events jsonb NOT NULL,
  creative_angles jsonb NOT NULL,
  format_mix jsonb NOT NULL,
  audience_strategy text NOT NULL,
  compliance_constraints jsonb NOT NULL DEFAULT '[]',
  performance_priors jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','deprecated')),
  requires_signoff boolean NOT NULL DEFAULT false,
  signed_off_at timestamptz,
  signed_off_by text
);

CREATE TABLE campaign_specs (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  playbook_id text REFERENCES playbooks(id),
  business_model text NOT NULL CHECK (business_model IN ('ecommerce','lead_generation','app','subscription','booking')),
  terminal_event text NOT NULL,
  optimization_event text NOT NULL,
  funnel_stages jsonb NOT NULL,
  price_tier text NOT NULL CHECK (price_tier IN ('low','mid','high','premium')),
  creative_angle text NOT NULL,
  policy_category text NOT NULL CHECK (policy_category IN ('standard','restricted')),
  target_platforms jsonb NOT NULL,
  audience_strategy text NOT NULL,
  format_mix jsonb NOT NULL,
  goal text,
  daily_budget numeric(14,4),
  budget_currency text,
  destination jsonb,
  consolidation_group text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creatives (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  variant_no integer NOT NULL,
  format text NOT NULL CHECK (format IN ('1:1','9:16','16:9')),
  asset_type text NOT NULL CHECK (asset_type IN ('image','video','copy')),
  asset_ref text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  content_id text NOT NULL,
  predicted_score numeric(6,4),
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','held','launched','blocked','expired','retired')),
  fatigue_state text NOT NULL DEFAULT 'fresh' CHECK (fatigue_state IN ('fresh','tiring','fatigued')),
  promo_id text,
  price_bearing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id text PRIMARY KEY,
  spec_id text NOT NULL REFERENCES campaign_specs(id),
  platform text NOT NULL CHECK (platform IN ('meta','google','tiktok')),
  platform_campaign_id text,
  campaign_type text NOT NULL,
  objective text NOT NULL,
  optimization_event text NOT NULL,
  budget numeric(14,4) NOT NULL,
  budget_mode text NOT NULL DEFAULT 'daily' CHECK (budget_mode IN ('daily','lifetime')),
  status text NOT NULL DEFAULT 'launching' CHECK (status IN ('launching','learning','autonomous','needs_attention','paused','ended')),
  learning_state text NOT NULL DEFAULT 'pending' CHECK (learning_state IN ('pending','learning','exited','stuck')),
  allocation_autonomous boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX campaigns_spec_platform_uq ON campaigns(spec_id, platform);

CREATE TABLE conversion_events (
  id text PRIMARY KEY,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL,
  value numeric(14,4),
  currency text,
  content_id text NOT NULL,
  click_ids jsonb NOT NULL DEFAULT '{}',
  hashed_identifiers jsonb NOT NULL DEFAULT '{}',
  event_id text NOT NULL,
  source_site text NOT NULL,
  consent_granted boolean NOT NULL DEFAULT true,
  relayed_to jsonb NOT NULL DEFAULT '[]',
  dedup_key text NOT NULL,
  reconciliation_key text NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conversion_events_site_event_uq ON conversion_events(source_site, event_id);
CREATE INDEX conversion_events_recon_idx ON conversion_events(reconciliation_key);
CREATE INDEX conversion_events_content_idx ON conversion_events(content_id);

CREATE TABLE decisions (
  id text PRIMARY KEY,
  loop text NOT NULL CHECK (loop IN ('fast','medium','slow','system')),
  worker text NOT NULL,
  action_type text NOT NULL,
  target_ref text NOT NULL,
  rationale text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  predicted_outcome text,
  guardrail_status text NOT NULL CHECK (guardrail_status IN ('passed','blocked','escalated')),
  executed boolean NOT NULL,
  product_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_target_idx ON decisions(target_ref);
CREATE INDEX decisions_product_idx ON decisions(product_id);

CREATE TABLE decision_outcomes (
  id text PRIMARY KEY,
  decision_id text NOT NULL REFERENCES decisions(id),
  actual_outcome text NOT NULL,
  scored_delta numeric(10,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cost_events (
  id text PRIMARY KEY,
  cost_type text NOT NULL CHECK (cost_type IN ('ad_spend','ai_inference')),
  operation text CHECK (operation IN ('classification','creative_image','creative_video','creative_copy','narration')),
  provider_or_platform text NOT NULL,
  model text,
  units jsonb NOT NULL DEFAULT '{}',
  unit_price numeric(14,8),
  amount numeric(14,6) NOT NULL,
  currency text NOT NULL,
  product_id text,
  campaign_id text,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX cost_events_product_idx ON cost_events(product_id);

CREATE TABLE system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_keys (
  id text PRIMARY KEY,
  source_site text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Insert-only enforcement at the database level (CLAUDE.md invariant 3).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only: % not permitted', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER decisions_immutable
  BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER decision_outcomes_immutable
  BEFORE UPDATE OR DELETE ON decision_outcomes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER cost_events_immutable
  BEFORE UPDATE OR DELETE ON cost_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- The kill switch exists from migration zero so it can never be missing.
INSERT INTO system_settings (key, value) VALUES ('kill_switch', '{"engaged": false}');
