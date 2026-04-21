-- Revert security_events.tonneau_tent_mode to BOOLEAN.
-- WARNING: This loses enum granularity — only 'Active'/'true' map to TRUE, everything else to FALSE.
UPDATE security_events SET tonneau_tent_mode = CASE
    WHEN tonneau_tent_mode IN ('Active', 'true') THEN 'true'
    ELSE 'false'
END WHERE tonneau_tent_mode IS NOT NULL;

ALTER TABLE security_events ALTER COLUMN tonneau_tent_mode TYPE BOOLEAN USING tonneau_tent_mode::BOOLEAN;
