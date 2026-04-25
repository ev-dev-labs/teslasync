-- Migration 000044: Drop legacy snapshot tables
-- Phase-14 prompt 13 — these tables are superseded by the typed schema
-- (signal_observations, vehicle_meta_snapshots, positions, security_events,
-- charging_telemetry hypertable) introduced in the baseline_typed migration.
--
-- CASCADE handles any dependent foreign keys, views, indexes, and policies.
-- IF EXISTS makes this idempotent (safe to re-run).

DROP TABLE IF EXISTS motor_snapshots              CASCADE;
DROP TABLE IF EXISTS climate_snapshots             CASCADE;
DROP TABLE IF EXISTS location_snapshots            CASCADE;
DROP TABLE IF EXISTS safety_snapshots              CASCADE;
DROP TABLE IF EXISTS battery_snapshots             CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots        CASCADE;
DROP TABLE IF EXISTS user_preference_snapshots      CASCADE;
DROP TABLE IF EXISTS vehicle_meta_snapshots         CASCADE;
DROP TABLE IF EXISTS vehicle_live_state             CASCADE;
DROP TABLE IF EXISTS charging_telemetry             CASCADE;
DROP TABLE IF EXISTS charge_telemetry_readings      CASCADE;
DROP TABLE IF EXISTS drive_telemetry_readings       CASCADE;
