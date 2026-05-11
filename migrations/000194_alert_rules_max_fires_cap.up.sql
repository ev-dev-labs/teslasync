-- 000194_alert_rules_max_fires_cap.up.sql
-- Phase-49 / Slice 0003 — Decision D5.
--
-- Per-rule cap on how many notifications a `repeat`-mode rule may emit
-- between successive falling-edge resets. NULL = legacy unlimited
-- behaviour (existing rules are NOT backfilled per Decision D4 — silently
-- changing their behaviour would surprise operators).
--
-- The counter side of this cap (alert_rule_state.fire_count_since_reset)
-- already lands in migration 000193 (slice 0002). This migration adds
-- only the per-rule limit column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CHECK constraint inside the
-- column definition is safe to re-apply.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS max_fires_per_resolution INTEGER NULL
    CHECK (max_fires_per_resolution IS NULL OR max_fires_per_resolution > 0);

COMMENT ON COLUMN alert_rules.max_fires_per_resolution IS
    'For repeat-mode rules: stop firing after N fires until the condition resolves (falling edge clears the counter). NULL = unlimited (legacy behaviour). Once-mode rules ignore this column — the latch already caps them at 1 per resolution.';
