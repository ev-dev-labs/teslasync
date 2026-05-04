-- Phase-42 / Prompt 0032 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no charging_telemetry / charging_sessions tables;
-- any consumer that requires them must re-apply the up.sql.
DROP TABLE IF EXISTS charging_telemetry CASCADE;
DROP TABLE IF EXISTS charging_sessions  CASCADE;
