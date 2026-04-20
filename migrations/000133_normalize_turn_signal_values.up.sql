-- Normalize LightsTurnSignal values.
-- Tesla sends prefixed enum values like "TurnSignalStateOff", "TurnSignalLeft".
-- This migration strips the prefix to store clean values matching other normalized enums.

-- vehicle_live_state
UPDATE vehicle_live_state SET lights_turn_signal = CASE
    WHEN lights_turn_signal = 'TurnSignalStateOff' THEN 'Off'
    WHEN lights_turn_signal = 'TurnSignalStateLeft' THEN 'Left'
    WHEN lights_turn_signal = 'TurnSignalStateRight' THEN 'Right'
    WHEN lights_turn_signal = 'TurnSignalStateBoth' THEN 'Both'
    WHEN lights_turn_signal = 'TurnSignalOff' THEN 'Off'
    WHEN lights_turn_signal = 'TurnSignalLeft' THEN 'Left'
    WHEN lights_turn_signal = 'TurnSignalRight' THEN 'Right'
    WHEN lights_turn_signal = 'TurnSignalBoth' THEN 'Both'
    ELSE lights_turn_signal
END
WHERE lights_turn_signal LIKE 'TurnSignal%';

-- security_events
UPDATE security_events SET lights_turn_signal = CASE
    WHEN lights_turn_signal = 'TurnSignalStateOff' THEN 'Off'
    WHEN lights_turn_signal = 'TurnSignalStateLeft' THEN 'Left'
    WHEN lights_turn_signal = 'TurnSignalStateRight' THEN 'Right'
    WHEN lights_turn_signal = 'TurnSignalStateBoth' THEN 'Both'
    WHEN lights_turn_signal = 'TurnSignalOff' THEN 'Off'
    WHEN lights_turn_signal = 'TurnSignalLeft' THEN 'Left'
    WHEN lights_turn_signal = 'TurnSignalRight' THEN 'Right'
    WHEN lights_turn_signal = 'TurnSignalBoth' THEN 'Both'
    ELSE lights_turn_signal
END
WHERE lights_turn_signal LIKE 'TurnSignal%';

-- signal_history
UPDATE signal_history SET value_str = CASE
    WHEN value_str = 'TurnSignalStateOff' THEN 'Off'
    WHEN value_str = 'TurnSignalStateLeft' THEN 'Left'
    WHEN value_str = 'TurnSignalStateRight' THEN 'Right'
    WHEN value_str = 'TurnSignalStateBoth' THEN 'Both'
    WHEN value_str = 'TurnSignalOff' THEN 'Off'
    WHEN value_str = 'TurnSignalLeft' THEN 'Left'
    WHEN value_str = 'TurnSignalRight' THEN 'Right'
    WHEN value_str = 'TurnSignalBoth' THEN 'Both'
    ELSE value_str
END
WHERE signal = 'LightsTurnSignal'
  AND value_str LIKE 'TurnSignal%';
