-- Rollback migration 000045: Drop continuous aggregates for dashboard reads
-- Policies are automatically dropped with the views (CASCADE).

DROP MATERIALIZED VIEW IF EXISTS cagg_battery_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_climate_hourly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_vehicle_daily CASCADE;
