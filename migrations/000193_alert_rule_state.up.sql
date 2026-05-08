-- 000193_alert_rule_state.up.sql
-- Phase-49 / Slice 0002 — persistent per-(rule, vehicle) firing state for
-- the streaming alert engine.
--
-- Why this is its own table (NOT additional columns on alert_rules): we
-- need per-vehicle latch even for fleet-wide rules (alert_rules.vehicle_id
-- IS NULL ⇒ rule applies to every vehicle). Putting the state on
-- alert_rules would force a single shared latch, breaking the "Locked
-- alert fires once per vehicle until that vehicle unlocks" semantics.
--
-- Phase-49 / Decision D9 (locked in 0000-methodology).
--
-- This migration is idempotent: every CREATE uses IF NOT EXISTS so a
-- partial-applied state can be replayed cleanly.

CREATE TABLE IF NOT EXISTS alert_rule_state (
    rule_id                BIGINT      NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    vehicle_id             BIGINT      NOT NULL REFERENCES vehicles(id)    ON DELETE CASCADE,
    latched_at             TIMESTAMPTZ NULL,
    last_fired_at          TIMESTAMPTZ NULL,
    fire_count_since_reset INTEGER     NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS alert_rule_state_rule_id_idx
    ON alert_rule_state (rule_id);

CREATE INDEX IF NOT EXISTS alert_rule_state_vehicle_id_idx
    ON alert_rule_state (vehicle_id);

COMMENT ON TABLE  alert_rule_state IS
    'Phase-49: persistent per-(rule, vehicle) firing state — survives pod restarts. Owned by internal/api/rule_engine.go via internal/database/alert_rule_state_repo.go.';

COMMENT ON COLUMN alert_rule_state.latched_at IS
    'Set when a once-mode rule fires; cleared by ClearLatch() on falling edge. NULL means the rule may fire on next match.';

COMMENT ON COLUMN alert_rule_state.last_fired_at IS
    'Most recent successful fire — feeds the cooldown gate (slice 0004 will consolidate cooldown bookkeeping here).';

COMMENT ON COLUMN alert_rule_state.fire_count_since_reset IS
    'Counter for max_fires_per_resolution cap (slice 0003 adds the alert_rules.max_fires_per_resolution column that this counter is compared against).';
