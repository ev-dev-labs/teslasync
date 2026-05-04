-- Phase-42 / Prompt 0036 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling
-- back this migration leaves no derived rollups; any consumer that
-- requires them must re-apply the up.sql.
--
-- CASCADE removes any view, index, or refresh policy attached to each
-- rollup. add_continuous_aggregate_policy registrations are removed
-- automatically by DROP MATERIALIZED VIEW for the real continuous
-- aggregates (TimescaleDB cleans up the policy when the cagg goes
-- away). UNIQUE INDEXES on the regular MVs (cagg_fleet_stats_pk,
-- cagg_charging_summary_pk, mv_energy_daily_pk, mv_position_hourly_pk,
-- mv_signal_stats_pk) are dropped as dependents of their MVs.
DROP MATERIALIZED VIEW IF EXISTS mv_signal_stats        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_energy_daily        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_summary  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_vehicle_daily     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_fleet_stats       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_signal_hourly     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_climate_hourly    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_battery_daily     CASCADE;
