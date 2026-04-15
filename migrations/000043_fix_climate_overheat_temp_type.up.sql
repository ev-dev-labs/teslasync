-- Fix cabin_overheat_protection_temp_limit: Tesla sends enum strings
-- like 'ClimateOverheatProtectionTempLimitLow', not numeric values.
ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE VARCHAR(50)
    USING CASE WHEN cabin_overheat_protection_temp_limit IS NULL THEN NULL
               ELSE cabin_overheat_protection_temp_limit::text END;
