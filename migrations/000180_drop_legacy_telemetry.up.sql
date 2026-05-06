-- Phase-42 migration 000180: DROP CASCADE all legacy telemetry tables.
--
-- ONE-WAY operation. Per ADR-004 #4 (forward-only, no backfill), all of these
-- tables are empty in production at the time of this migration because every
-- consumer was migrated to the new SI-canonical schema in prompts 0060-0077
-- before this prompt ran. Several of these names (positions, drives,
-- charging_sessions, trips, trip_drives, *_snapshots, fsm_transitions,
-- vehicle_live_state) are RECREATED with new SI columns by migrations
-- 000181-000188; the rest are gone for good.
--
-- DEPLOY ORDERING -- CRITICAL.
-- golang-migrate applies one file per transaction. This migration (000180) and
-- the recreate migrations (000181-000188) are SEPARATE files and do NOT share
-- a transaction. The deploy MUST apply 000180 through 000188 as a single
-- `migrate up` step BEFORE any application pod is rolled. Any pod started
-- against a DB at version 180 (drop done, recreate not yet) will crash on
-- first query. See runbook in prompt 0090.

BEGIN;

-- Bound the blast radius. If anything is holding a lock on these tables
-- (e.g., a stray analytics query, an unmigrated worker), fail fast instead
-- of stalling the deploy and blocking every other writer.
SET LOCAL lock_timeout      = '30s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS positions, positions_default,
  battery_snapshots, climate_snapshots, motor_snapshots,
  security_events, tire_pressure_snapshots, media_snapshots,
  safety_snapshots, location_snapshots,
  user_preference_snapshots, vehicle_config_snapshots, vehicle_meta_snapshots,
  charging_telemetry, charge_telemetry_readings, drive_telemetry_readings,
  signal_observations, signal_history, signal_catalog, vehicle_live_state,
  vehicle_units, fsm_transitions, fleet_telemetry_subscriptions,
  mv_energy_daily, mv_position_hourly, mv_signal_stats,
  cagg_battery_daily, cagg_climate_hourly, cagg_signal_hourly,
  cagg_fleet_stats, cagg_vehicle_daily, cagg_charging_summary,
  drives, charging_sessions, trips, trip_drives,
  vampire_drain_events, daily_mileage, visited_locations,
  vehicle_states, guard_events
CASCADE;

COMMIT;
