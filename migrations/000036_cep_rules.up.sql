-- Migration 36: Enhance alert_rules for CEP rule engine
-- Adds JSONB conditions, temporal operators, cooldown, notification channels,
-- and rule state tracking for the Complex Event Processing engine.

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS conditions      JSONB,
  ADD COLUMN IF NOT EXISTS expression      TEXT,
  ADD COLUMN IF NOT EXISTS cooldown_min    INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS for_duration_s  INTEGER,
  ADD COLUMN IF NOT EXISTS severity        VARCHAR(20) NOT NULL DEFAULT 'warning',
  ADD COLUMN IF NOT EXISTS msg_template    TEXT,
  ADD COLUMN IF NOT EXISTS notify_channels INTEGER[],
  ADD COLUMN IF NOT EXISTS last_fired_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fire_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags            TEXT[];

-- Add severity to alerts table if missing
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'warning';

-- Index for efficient rule loading
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled) WHERE enabled = true;
