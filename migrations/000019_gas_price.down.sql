-- Reverse migration 19
ALTER TABLE settings DROP COLUMN IF EXISTS gas_price_per_unit;
ALTER TABLE settings DROP COLUMN IF EXISTS gas_unit;
ALTER TABLE settings DROP COLUMN IF EXISTS gas_efficiency_mpg;
