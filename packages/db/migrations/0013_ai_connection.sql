-- 0013: the AI provider is connectable through the UI like the ad channels.
ALTER TABLE platform_connections DROP CONSTRAINT platform_connections_platform_check;
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('meta','google','tiktok','snapchat','pinterest','ai'));
