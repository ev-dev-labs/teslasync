-- Normalize TonneauTentMode enum values: strip "TonneauTentMode" prefix.
-- Tesla sends: "TonneauTentModeActive" → "Active", "TonneauTentModeOff" → "Off", etc.

UPDATE vehicle_live_state SET tonneau_tent_mode = SUBSTRING(tonneau_tent_mode FROM LENGTH('TonneauTentMode') + 1)
WHERE tonneau_tent_mode IS NOT NULL
  AND tonneau_tent_mode LIKE 'TonneauTentMode%';

UPDATE security_events SET tonneau_tent_mode = SUBSTRING(tonneau_tent_mode FROM LENGTH('TonneauTentMode') + 1)
WHERE tonneau_tent_mode IS NOT NULL
  AND tonneau_tent_mode LIKE 'TonneauTentMode%';
