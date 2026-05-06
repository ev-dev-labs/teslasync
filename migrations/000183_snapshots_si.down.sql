-- Phase-42 / Prompt 0031 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no snapshot tables; any consumer that requires
-- one must re-apply the up.sql.
DROP TABLE IF EXISTS climate_snapshots        CASCADE;
DROP TABLE IF EXISTS motor_snapshots          CASCADE;
DROP TABLE IF EXISTS security_events          CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots  CASCADE;
DROP TABLE IF EXISTS media_snapshots          CASCADE;
DROP TABLE IF EXISTS safety_snapshots         CASCADE;
DROP TABLE IF EXISTS location_snapshots       CASCADE;
