-- Runs once on fresh PGDATA via /docker-entrypoint-initdb.d/
-- Idempotent — IF NOT EXISTS guards everything.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Optional but recommended for migration 142 idempotency:
ALTER DATABASE teslasync SET timescaledb.telemetry_level = 'off';
