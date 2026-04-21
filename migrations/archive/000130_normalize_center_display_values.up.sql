-- Normalize CenterDisplay values.
-- Tesla sends prefixed enum values like "DisplayStateOff", "DisplayStateOn", "DisplayStateDim".
-- This migration strips the prefix to store clean values matching the other normalized enums.

-- vehicle_live_state
UPDATE vehicle_live_state SET center_display = CASE
    WHEN center_display = 'DisplayStateOff' THEN 'Off'
    WHEN center_display = 'DisplayStateDim' THEN 'Dim'
    WHEN center_display = 'DisplayStateAccessory' THEN 'Accessory'
    WHEN center_display = 'DisplayStateOn' THEN 'On'
    WHEN center_display = 'DisplayStateDriving' THEN 'Driving'
    WHEN center_display = 'DisplayStateCharging' THEN 'Charging'
    WHEN center_display = 'DisplayStateLock' THEN 'Lock'
    WHEN center_display = 'DisplayStateSentry' THEN 'Sentry'
    WHEN center_display = 'DisplayStateDog' THEN 'Dog'
    WHEN center_display = 'DisplayStateEntertainment' THEN 'Entertainment'
    ELSE center_display
END
WHERE center_display LIKE 'DisplayState%';

-- security_events
UPDATE security_events SET center_display = CASE
    WHEN center_display = 'DisplayStateOff' THEN 'Off'
    WHEN center_display = 'DisplayStateDim' THEN 'Dim'
    WHEN center_display = 'DisplayStateAccessory' THEN 'Accessory'
    WHEN center_display = 'DisplayStateOn' THEN 'On'
    WHEN center_display = 'DisplayStateDriving' THEN 'Driving'
    WHEN center_display = 'DisplayStateCharging' THEN 'Charging'
    WHEN center_display = 'DisplayStateLock' THEN 'Lock'
    WHEN center_display = 'DisplayStateSentry' THEN 'Sentry'
    WHEN center_display = 'DisplayStateDog' THEN 'Dog'
    WHEN center_display = 'DisplayStateEntertainment' THEN 'Entertainment'
    ELSE center_display
END
WHERE center_display LIKE 'DisplayState%';

-- signal_history
UPDATE signal_history SET value_str = CASE
    WHEN value_str = 'DisplayStateOff' THEN 'Off'
    WHEN value_str = 'DisplayStateDim' THEN 'Dim'
    WHEN value_str = 'DisplayStateAccessory' THEN 'Accessory'
    WHEN value_str = 'DisplayStateOn' THEN 'On'
    WHEN value_str = 'DisplayStateDriving' THEN 'Driving'
    WHEN value_str = 'DisplayStateCharging' THEN 'Charging'
    WHEN value_str = 'DisplayStateLock' THEN 'Lock'
    WHEN value_str = 'DisplayStateSentry' THEN 'Sentry'
    WHEN value_str = 'DisplayStateDog' THEN 'Dog'
    WHEN value_str = 'DisplayStateEntertainment' THEN 'Entertainment'
    ELSE value_str
END
WHERE signal = 'CenterDisplay'
  AND value_str LIKE 'DisplayState%';
