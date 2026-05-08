ALTER TABLE tesla_charging_history
  ADD COLUMN IF NOT EXISTS usage_kwh DOUBLE PRECISION;

UPDATE tesla_charging_history
SET usage_kwh = usage_wh / 1000.0
WHERE usage_kwh IS NULL
  AND usage_wh IS NOT NULL;

ALTER TABLE tesla_charging_history
  DROP COLUMN IF EXISTS usage_wh;
