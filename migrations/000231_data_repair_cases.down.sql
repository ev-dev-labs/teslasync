-- Rollback for 000231_data_repair_cases: drop all case-management tables.
-- Order matters: quarantine references cases, comments reference cases.
BEGIN;

DROP INDEX IF EXISTS charging_sessions_vehicle_ended_repair_scan;
DROP INDEX IF EXISTS drives_vehicle_ended_repair_scan;
DROP TABLE IF EXISTS data_repair_quarantine;
DROP TABLE IF EXISTS data_repair_scan_runs;
DROP TABLE IF EXISTS data_repair_case_comments;
DROP TABLE IF EXISTS data_repair_cases;

COMMIT;
