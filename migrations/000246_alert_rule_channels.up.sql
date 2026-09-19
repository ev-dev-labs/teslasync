ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS channel_ids BIGINT[];
COMMENT ON COLUMN alert_rules.channel_ids IS 'NULL uses all enabled external channels; empty array disables external delivery; otherwise restrict to these channel IDs. Browser delivery is unchanged.';
