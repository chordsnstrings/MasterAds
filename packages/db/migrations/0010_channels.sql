-- 0010_channels (W4): widen platform sets to include snapchat and pinterest.
ALTER TABLE campaigns DROP CONSTRAINT campaigns_platform_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_platform_check
  CHECK (platform IN ('meta','google','tiktok','snapchat','pinterest'));

ALTER TABLE ad_accounts DROP CONSTRAINT ad_accounts_platform_check;
ALTER TABLE ad_accounts ADD CONSTRAINT ad_accounts_platform_check
  CHECK (platform IN ('meta','google','tiktok','snapchat','pinterest'));

ALTER TABLE click_id_coverage DROP CONSTRAINT click_id_coverage_platform_check;
ALTER TABLE click_id_coverage ADD CONSTRAINT click_id_coverage_platform_check
  CHECK (platform IN ('meta','google','tiktok','snapchat','pinterest'));
