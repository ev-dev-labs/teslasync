-- Normalize ChargeState and DetailedChargeState values.
-- Tesla sends prefixed enum values like "ChargeStateCharging", "DetailedChargeStateComplete".
-- This migration strips the prefix to store clean values matching the other normalized enums.

-- vehicle_live_state: ChargeState
UPDATE vehicle_live_state SET charge_state = CASE
    WHEN charge_state IN ('ChargeStateCharging', 'ChargeStateEnable') THEN 'Charging'
    WHEN charge_state = 'ChargeStateComplete' THEN 'Complete'
    WHEN charge_state = 'ChargeStateDisconnected' THEN 'Disconnected'
    WHEN charge_state = 'ChargeStateNoPower' THEN 'NoPower'
    WHEN charge_state = 'ChargeStateStarting' THEN 'Starting'
    WHEN charge_state = 'ChargeStateStopped' THEN 'Stopped'
    WHEN charge_state = 'Enable' THEN 'Charging'
    ELSE charge_state
END
WHERE charge_state LIKE 'ChargeState%' OR charge_state = 'Enable';

-- vehicle_live_state: DetailedChargeState
UPDATE vehicle_live_state SET detailed_charge_state = CASE
    WHEN detailed_charge_state = 'DetailedChargeStateCharging' THEN 'Charging'
    WHEN detailed_charge_state = 'DetailedChargeStateComplete' THEN 'Complete'
    WHEN detailed_charge_state = 'DetailedChargeStateDisconnected' THEN 'Disconnected'
    WHEN detailed_charge_state = 'DetailedChargeStateNoPower' THEN 'NoPower'
    WHEN detailed_charge_state = 'DetailedChargeStateStarting' THEN 'Starting'
    WHEN detailed_charge_state = 'DetailedChargeStateStopped' THEN 'Stopped'
    WHEN detailed_charge_state = 'DetailedChargeStateError' THEN 'Error'
    ELSE detailed_charge_state
END
WHERE detailed_charge_state LIKE 'DetailedChargeState%';

-- charging_telemetry: ChargeState
UPDATE charging_telemetry SET charge_state = CASE
    WHEN charge_state IN ('ChargeStateCharging', 'ChargeStateEnable') THEN 'Charging'
    WHEN charge_state = 'ChargeStateComplete' THEN 'Complete'
    WHEN charge_state = 'ChargeStateDisconnected' THEN 'Disconnected'
    WHEN charge_state = 'ChargeStateNoPower' THEN 'NoPower'
    WHEN charge_state = 'ChargeStateStarting' THEN 'Starting'
    WHEN charge_state = 'ChargeStateStopped' THEN 'Stopped'
    WHEN charge_state = 'Enable' THEN 'Charging'
    ELSE charge_state
END
WHERE charge_state LIKE 'ChargeState%' OR charge_state = 'Enable';

-- charging_telemetry: DetailedChargeState
UPDATE charging_telemetry SET detailed_charge_state = CASE
    WHEN detailed_charge_state = 'DetailedChargeStateCharging' THEN 'Charging'
    WHEN detailed_charge_state = 'DetailedChargeStateComplete' THEN 'Complete'
    WHEN detailed_charge_state = 'DetailedChargeStateDisconnected' THEN 'Disconnected'
    WHEN detailed_charge_state = 'DetailedChargeStateNoPower' THEN 'NoPower'
    WHEN detailed_charge_state = 'DetailedChargeStateStarting' THEN 'Starting'
    WHEN detailed_charge_state = 'DetailedChargeStateStopped' THEN 'Stopped'
    WHEN detailed_charge_state = 'DetailedChargeStateError' THEN 'Error'
    ELSE detailed_charge_state
END
WHERE detailed_charge_state LIKE 'DetailedChargeState%';

-- signal_history: ChargeState
UPDATE signal_history SET value_str = CASE
    WHEN value_str IN ('ChargeStateCharging', 'ChargeStateEnable') THEN 'Charging'
    WHEN value_str = 'ChargeStateComplete' THEN 'Complete'
    WHEN value_str = 'ChargeStateDisconnected' THEN 'Disconnected'
    WHEN value_str = 'ChargeStateNoPower' THEN 'NoPower'
    WHEN value_str = 'ChargeStateStarting' THEN 'Starting'
    WHEN value_str = 'ChargeStateStopped' THEN 'Stopped'
    WHEN value_str = 'Enable' THEN 'Charging'
    ELSE value_str
END
WHERE signal = 'ChargeState'
  AND (value_str LIKE 'ChargeState%' OR value_str = 'Enable');

-- signal_history: DetailedChargeState
UPDATE signal_history SET value_str = CASE
    WHEN value_str = 'DetailedChargeStateCharging' THEN 'Charging'
    WHEN value_str = 'DetailedChargeStateComplete' THEN 'Complete'
    WHEN value_str = 'DetailedChargeStateDisconnected' THEN 'Disconnected'
    WHEN value_str = 'DetailedChargeStateNoPower' THEN 'NoPower'
    WHEN value_str = 'DetailedChargeStateStarting' THEN 'Starting'
    WHEN value_str = 'DetailedChargeStateStopped' THEN 'Stopped'
    WHEN value_str = 'DetailedChargeStateError' THEN 'Error'
    ELSE value_str
END
WHERE signal = 'DetailedChargeState'
  AND value_str LIKE 'DetailedChargeState%';
