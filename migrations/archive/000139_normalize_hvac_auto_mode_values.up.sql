-- Normalize HvacAutoMode enum values: strip "HvacAutoModeState" prefix.
-- Tesla sends: "HvacAutoModeStateOn" → "On", "HvacAutoModeStateOff" → "Off", etc.

UPDATE vehicle_live_state SET hvac_auto_mode = SUBSTRING(hvac_auto_mode FROM LENGTH('HvacAutoModeState') + 1)
WHERE hvac_auto_mode IS NOT NULL
  AND hvac_auto_mode LIKE 'HvacAutoModeState%';

UPDATE climate_snapshots SET hvac_auto_mode = SUBSTRING(hvac_auto_mode FROM LENGTH('HvacAutoModeState') + 1)
WHERE hvac_auto_mode IS NOT NULL
  AND hvac_auto_mode LIKE 'HvacAutoModeState%';

UPDATE signal_history SET value_str = SUBSTRING(value_str FROM LENGTH('HvacAutoModeState') + 1)
WHERE signal = 'HvacAutoMode'
  AND value_str IS NOT NULL
  AND value_str LIKE 'HvacAutoModeState%';
