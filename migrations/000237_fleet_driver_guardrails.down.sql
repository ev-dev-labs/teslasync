ALTER TABLE fleet_drivers DROP CONSTRAINT IF EXISTS fleet_drivers_max_charge_soc_range;
ALTER TABLE fleet_drivers
    DROP COLUMN IF EXISTS max_charge_soc,
    DROP COLUMN IF EXISTS curfew_start,
    DROP COLUMN IF EXISTS curfew_end;
