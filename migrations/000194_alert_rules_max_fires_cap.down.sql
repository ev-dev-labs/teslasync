-- 000194_alert_rules_max_fires_cap.down.sql
-- Reverse of 000194_alert_rules_max_fires_cap.up.sql.

ALTER TABLE alert_rules
    DROP COLUMN IF EXISTS max_fires_per_resolution;
