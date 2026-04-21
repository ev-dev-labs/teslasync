-- Widen security_events.tonneau_tent_mode from BOOLEAN to TEXT.
-- TonneauTentMode is a TypeEnum signal (string values like "Active", "Off"),
-- not a boolean. The original migration 000017 incorrectly created it as BOOLEAN.
-- Step 1: Change column type (boolean → text via cast)
ALTER TABLE security_events ALTER COLUMN tonneau_tent_mode TYPE TEXT USING tonneau_tent_mode::TEXT;

-- Step 2: Map old boolean string representations to enum values
UPDATE security_events SET tonneau_tent_mode = CASE
    WHEN tonneau_tent_mode = 'true' THEN 'Active'
    WHEN tonneau_tent_mode = 'false' THEN 'Off'
    ELSE tonneau_tent_mode
END WHERE tonneau_tent_mode IN ('true', 'false');
