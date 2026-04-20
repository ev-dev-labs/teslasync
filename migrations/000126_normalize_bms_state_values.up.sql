-- Backfill: strip "BMSState" prefix from bms_state values in vehicle_live_state
-- and charging_telemetry. These were stored with the raw Tesla prefix due to
-- missing normalization in normalizeFleetUnits().
UPDATE vehicle_live_state
SET bms_state = REPLACE(bms_state, 'BMSState', '')
WHERE bms_state LIKE 'BMSState%';

UPDATE charging_telemetry
SET bms_state = REPLACE(bms_state, 'BMSState', '')
WHERE bms_state LIKE 'BMSState%';

UPDATE signal_history
SET value_str = REPLACE(value_str, 'BMSState', '')
WHERE signal = 'BMSState' AND value_str LIKE 'BMSState%';
