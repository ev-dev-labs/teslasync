-- Rollback migration 23: Remove backup & restore tables
DROP TABLE IF EXISTS backup_runs;
DROP TABLE IF EXISTS backup_configs;
