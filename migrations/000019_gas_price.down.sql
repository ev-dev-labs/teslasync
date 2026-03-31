-- Reverse migration 19
DROP FUNCTION IF EXISTS gas_price_at(TIMESTAMPTZ);
DROP TABLE IF EXISTS gas_price_history;
ALTER TABLE settings DROP COLUMN IF EXISTS gas_price_per_unit;
ALTER TABLE settings DROP COLUMN IF EXISTS gas_unit;
ALTER TABLE settings DROP COLUMN IF EXISTS gas_efficiency_mpg;
