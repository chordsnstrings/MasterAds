-- 0016 (W10): the AI manager is a priced inference operation like any other.
ALTER TABLE cost_events DROP CONSTRAINT IF EXISTS cost_events_operation_check;
ALTER TABLE cost_events ADD CONSTRAINT cost_events_operation_check
  CHECK (operation IN ('classification','creative_image','creative_video','creative_copy','narration','management'));
