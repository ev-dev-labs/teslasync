-- Migration 216: Battery Passport provenance ledger (rollback).
--
-- Drops the index first (defensive; DROP TABLE would cascade it anyway) and
-- then the table. IF EXISTS keeps the rollback a safe no-op on a database
-- where the up migration never ran.

DROP INDEX IF EXISTS tesla_battery_passport_ledger_vehicle_issued_idx;
DROP TABLE IF EXISTS tesla_battery_passport_ledger;
