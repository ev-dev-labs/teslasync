-- Normalize ScheduledChargingMode values.
-- Tesla sends prefixed enum values like "ScheduledChargingModeOff", "ScheduledChargingModeStartAt".
-- This migration strips the prefix to store clean values matching the other normalized enums.

-- vehicle_live_state
UPDATE vehicle_live_state SET scheduled_charging_mode = CASE
    WHEN scheduled_charging_mode = 'ScheduledChargingModeOff' THEN 'Off'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeStartAt' THEN 'StartAt'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeDepartBy' THEN 'DepartBy'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeUnknown' THEN 'Unknown'
    ELSE scheduled_charging_mode
END
WHERE scheduled_charging_mode LIKE 'ScheduledChargingMode%';

-- charging_telemetry
UPDATE charging_telemetry SET scheduled_charging_mode = CASE
    WHEN scheduled_charging_mode = 'ScheduledChargingModeOff' THEN 'Off'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeStartAt' THEN 'StartAt'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeDepartBy' THEN 'DepartBy'
    WHEN scheduled_charging_mode = 'ScheduledChargingModeUnknown' THEN 'Unknown'
    ELSE scheduled_charging_mode
END
WHERE scheduled_charging_mode LIKE 'ScheduledChargingMode%';

-- signal_history
UPDATE signal_history SET value_str = CASE
    WHEN value_str = 'ScheduledChargingModeOff' THEN 'Off'
    WHEN value_str = 'ScheduledChargingModeStartAt' THEN 'StartAt'
    WHEN value_str = 'ScheduledChargingModeDepartBy' THEN 'DepartBy'
    WHEN value_str = 'ScheduledChargingModeUnknown' THEN 'Unknown'
    ELSE value_str
END
WHERE signal = 'ScheduledChargingMode'
  AND value_str LIKE 'ScheduledChargingMode%';
