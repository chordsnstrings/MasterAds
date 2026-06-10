-- 0003_attention — attention records: the few situations a human must handle
-- (UX §7 attention-only escalation; raised by relay failures, billing health,
-- coverage drops, restricted approvals).
CREATE TABLE attention_records (
  id text PRIMARY KEY,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','approval','error')),
  message text NOT NULL,
  fix_hint text,
  target_ref text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX attention_open_idx ON attention_records(status, created_at);
