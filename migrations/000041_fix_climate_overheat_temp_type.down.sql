ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE DOUBLE PRECISION
    USING CASE WHEN cabin_overheat_protection_temp_limit IS NULL THEN NULL
               ELSE cabin_overheat_protection_temp_limit::double precision END;
