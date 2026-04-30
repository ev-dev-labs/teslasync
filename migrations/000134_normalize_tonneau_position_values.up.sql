-- Normalize TonneauPosition values.
-- Tesla sends prefixed enum values like "TonneauPositionStateClosed".
-- This migration strips the prefix to store clean values matching other normalized enums.

-- vehicle_live_state
UPDATE vehicle_live_state SET tonneau_position = SUBSTRING(tonneau_position FROM LENGTH('TonneauPositionState') + 1)
WHERE tonneau_position LIKE 'TonneauPositionState%';

-- security_events
UPDATE security_events SET tonneau_position = SUBSTRING(tonneau_position FROM LENGTH('TonneauPositionState') + 1)
WHERE tonneau_position LIKE 'TonneauPositionState%';

-- signal_history
UPDATE signal_history SET value_str = SUBSTRING(value_str FROM LENGTH('TonneauPositionState') + 1)
WHERE signal = 'TonneauPosition'
  AND value_str LIKE 'TonneauPositionState%';
