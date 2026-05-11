-- Migration 197 down: drop the unique index. Cannot un-dedupe rows.
DROP INDEX IF EXISTS uq_software_updates_vehicle_version;
