-- 0015 (W9): user-defined automation rules. Evaluated deterministically inside
-- the fast loop (invariant 6); pause/resume actions execute only through the
-- guardrail layer (invariant 1). Rules are settings, not audit rows — hard
-- delete allowed; the Decisions they produce are the audit trail.
CREATE TABLE automation_rules (
  id text PRIMARY KEY,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','product')),
  product_id text REFERENCES products(id),
  metric text NOT NULL CHECK (metric IN ('spend','results','cost_per_result','net_return')),
  window_days integer NOT NULL DEFAULT 3 CHECK (window_days IN (1,3,7)),
  comparator text NOT NULL CHECK (comparator IN ('gt','lt')),
  threshold numeric(14,4) NOT NULL,
  action text NOT NULL CHECK (action IN ('pause','resume','notify')),
  cooldown_hours integer NOT NULL DEFAULT 24,
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope = 'all' OR product_id IS NOT NULL)
);
CREATE INDEX automation_rules_enabled_idx ON automation_rules (enabled);
