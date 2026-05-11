-- Phase-48 Slice 3: Tesla billing charging-history energy usage is SI canonical.
ALTER TABLE tesla_charging_history
  ADD COLUMN IF NOT EXISTS usage_wh DOUBLE PRECISION;

UPDATE tesla_charging_history
SET usage_wh = usage_kwh * 1000.0
WHERE usage_wh IS NULL
  AND usage_kwh IS NOT NULL;

ALTER TABLE tesla_charging_history
  DROP COLUMN IF EXISTS usage_kwh;

COMMENT ON COLUMN tesla_charging_history.usage_wh IS
  'Charging energy usage in watt-hours (SI canonical).';
