-- Migration 36 (down)
ALTER TABLE alert_rules
  DROP COLUMN IF EXISTS conditions,
  DROP COLUMN IF EXISTS expression,
  DROP COLUMN IF EXISTS cooldown_min,
  DROP COLUMN IF EXISTS for_duration_s,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS msg_template,
  DROP COLUMN IF EXISTS notify_channels,
  DROP COLUMN IF EXISTS last_fired_at,
  DROP COLUMN IF EXISTS fire_count,
  DROP COLUMN IF EXISTS tags;

DROP INDEX IF EXISTS idx_alert_rules_enabled;
