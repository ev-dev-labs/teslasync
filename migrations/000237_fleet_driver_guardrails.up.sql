ALTER TABLE fleet_drivers
    ADD COLUMN IF NOT EXISTS max_charge_soc SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS curfew_start TEXT NULL,
    ADD COLUMN IF NOT EXISTS curfew_end TEXT NULL;

ALTER TABLE fleet_drivers
    ADD CONSTRAINT fleet_drivers_max_charge_soc_range
    CHECK (max_charge_soc IS NULL OR (max_charge_soc >= 20 AND max_charge_soc <= 100));
