-- Migration 19: Add gas price fields for EV vs ICE cost comparison
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_price_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_unit VARCHAR(10) NOT NULL DEFAULT 'gallon';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gas_efficiency_mpg DOUBLE PRECISION NOT NULL DEFAULT 25;

-- Gas price history — tracks price changes over time so old sessions
-- compare with the price that was active during that period
CREATE TABLE IF NOT EXISTS gas_price_history (
    id             BIGSERIAL PRIMARY KEY,
    price_per_unit DOUBLE PRECISION NOT NULL,
    unit           VARCHAR(10) NOT NULL DEFAULT 'gallon',
    efficiency_mpg DOUBLE PRECISION NOT NULL DEFAULT 25,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gas_price_history_effective ON gas_price_history (effective_from, effective_to);

-- Helper function: get gas price active at a given timestamp
CREATE OR REPLACE FUNCTION gas_price_at(ts TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE(price_per_unit DOUBLE PRECISION, unit TEXT, efficiency_mpg DOUBLE PRECISION)
LANGUAGE SQL STABLE AS $$
  SELECT h.price_per_unit, h.unit::TEXT, h.efficiency_mpg
  FROM gas_price_history h
  WHERE h.effective_from <= ts
    AND (h.effective_to IS NULL OR h.effective_to > ts)
  ORDER BY h.effective_from DESC
  LIMIT 1;
$$;
