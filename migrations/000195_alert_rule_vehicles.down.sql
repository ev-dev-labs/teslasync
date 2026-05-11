-- Phase-49 / Slice 0005 — DOWN migration.
--
-- CAVEATS
-- =======
-- This down migration is LOSSY for multi-select rules. The legacy
-- `alert_rules.vehicle_id` column is single-valued; rules that targeted
-- multiple vehicles via the junction table will be reduced to
-- `MIN(vehicle_id)` for that rule. The other vehicle assignments are
-- DROPPED with the junction table.
--
-- Rules with `all_vehicles=TRUE` correctly map back to
-- `vehicle_id IS NULL` (the legacy "all vehicles" semantic).
--
-- The order matters: restore the legacy column FIRST (while the
-- junction still exists), THEN drop the junction, THEN drop the new
-- column. Reversing this order makes the restore impossible.

-- 1. Restore legacy vehicle_id from the junction. For true multi-select
--    rules this picks MIN(vehicle_id); the others are LOST.
UPDATE alert_rules ar
   SET vehicle_id = sub.vid
  FROM (
        SELECT rule_id, MIN(vehicle_id) AS vid
          FROM alert_rule_vehicles
         GROUP BY rule_id
       ) sub
 WHERE ar.id = sub.rule_id
   AND ar.all_vehicles = FALSE;

-- 2. Drop the junction table (cascades indexes via PG defaults).
DROP TABLE IF EXISTS alert_rule_vehicles;

-- 3. Drop the all_vehicles column.
ALTER TABLE alert_rules
    DROP COLUMN IF EXISTS all_vehicles;
