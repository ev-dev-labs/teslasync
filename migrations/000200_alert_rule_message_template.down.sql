-- Reverse Phase-50 / migration 000200. Drops the columns added by the up migration.
ALTER TABLE alert_rules
    DROP COLUMN IF EXISTS msg_template,
    DROP COLUMN IF EXISTS include_title;
