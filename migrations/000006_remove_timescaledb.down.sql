-- Down migration: no-op (can't restore TimescaleDB)
DROP FUNCTION IF EXISTS create_monthly_partition;
