-- Migration 39: Add quiet hours and alert digest settings
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start VARCHAR(5) NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end VARCHAR(5) NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS alert_digest_mode VARCHAR(10) NOT NULL DEFAULT 'instant';
