-- Phase-49 / Slice 0005 — Multi-select vehicle picker for alert rules.
--
-- Replaces the single nullable `alert_rules.vehicle_id` column with a
-- junction-table model:
--   * alert_rules.all_vehicles BOOLEAN   - sticky "all vehicles" flag
--                                          (TRUE means current AND future
--                                          vehicles fire this rule)
--   * alert_rule_vehicles                - explicit (rule, vehicle) pairs
--                                          when all_vehicles = FALSE
--
-- Mutual exclusion is enforced at the application layer (handler 422 +
-- repo Create/Update validation): all_vehicles = TRUE implies the
-- junction is empty for that rule. A DB CHECK constraint can't span
-- two tables; a trigger would add operational complexity for marginal
-- safety.
--
-- The legacy `alert_rules.vehicle_id` column is KEPT temporarily for
-- one release per Phase-49 / Slice 0005 / Decision D7 (rolling-deploy
-- safety: a downgraded API binary still reads the legacy column and
-- behaves correctly for single-vehicle rules). The repo Create/Update
-- writes `vehicle_id = MIN(VehicleIDs)` when `AllVehicles=FALSE`, NULL
-- otherwise. Removed in a future phase.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS all_vehicles BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS alert_rule_vehicles (
    rule_id    BIGINT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id)    ON DELETE CASCADE,
    PRIMARY KEY (rule_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS alert_rule_vehicles_rule_id_idx
    ON alert_rule_vehicles (rule_id);
CREATE INDEX IF NOT EXISTS alert_rule_vehicles_vehicle_id_idx
    ON alert_rule_vehicles (vehicle_id);

-- Backfill: existing rules with vehicle_id IS NOT NULL become
-- explicit single-vehicle rules. Rules with vehicle_id IS NULL keep
-- the column DEFAULT (TRUE) and remain "all vehicles".
UPDATE alert_rules
   SET all_vehicles = FALSE
 WHERE vehicle_id IS NOT NULL;

INSERT INTO alert_rule_vehicles (rule_id, vehicle_id)
SELECT id, vehicle_id
  FROM alert_rules
 WHERE vehicle_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN alert_rules.all_vehicles IS
    'TRUE = sticky-all (current + future vehicles). FALSE = explicit subset in alert_rule_vehicles.';
COMMENT ON COLUMN alert_rules.vehicle_id IS
    'DEPRECATED. Replaced by alert_rules.all_vehicles + alert_rule_vehicles. Kept for one release for rolling-deploy backward compat. Mirrors MIN(alert_rule_vehicles.vehicle_id) on writes when all_vehicles=FALSE.';
COMMENT ON TABLE  alert_rule_vehicles IS
    'Explicit (rule, vehicle) pairs for multi-select alert rules. Empty when alert_rules.all_vehicles=TRUE. Phase-49 / Slice 0005.';
