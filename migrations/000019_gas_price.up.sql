-- Migration 19: Add gas price fields for EV vs ICE cost comparison
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_price_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_unit VARCHAR(10) NOT NULL DEFAULT 'gallon';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_efficiency_mpg DOUBLE PRECISION NOT NULL DEFAULT 25;
