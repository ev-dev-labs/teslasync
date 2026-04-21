-- Backfill: strip "ChargePort" prefix from charge_port values and
-- "ChargePortLatch" prefix from charge_port_latch values. These were stored
-- with the raw Tesla prefix due to missing normalization in normalizeFleetUnits().

-- vehicle_live_state
UPDATE vehicle_live_state
SET charge_port = REPLACE(charge_port, 'ChargePort', '')
WHERE charge_port LIKE 'ChargePort%'
  AND charge_port NOT LIKE 'ChargePortLatch%';

UPDATE vehicle_live_state
SET charge_port_latch = REPLACE(charge_port_latch, 'ChargePortLatch', '')
WHERE charge_port_latch LIKE 'ChargePortLatch%';

-- vehicle_config_snapshots
UPDATE vehicle_config_snapshots
SET charge_port = REPLACE(charge_port, 'ChargePort', '')
WHERE charge_port LIKE 'ChargePort%'
  AND charge_port NOT LIKE 'ChargePortLatch%';

-- charging_telemetry
UPDATE charging_telemetry
SET charge_port_latch = REPLACE(charge_port_latch, 'ChargePortLatch', '')
WHERE charge_port_latch LIKE 'ChargePortLatch%';

-- signal_history
UPDATE signal_history
SET value_str = REPLACE(value_str, 'ChargePort', '')
WHERE signal = 'ChargePort' AND value_str LIKE 'ChargePort%'
  AND value_str NOT LIKE 'ChargePortLatch%';

UPDATE signal_history
SET value_str = REPLACE(value_str, 'ChargePortLatch', '')
WHERE signal = 'ChargePortLatch' AND value_str LIKE 'ChargePortLatch%';
