-- 0005_playbook_platforms — additive: default target platforms per playbook.
ALTER TABLE playbooks ADD COLUMN target_platforms jsonb NOT NULL DEFAULT '["meta","google","tiktok"]';
