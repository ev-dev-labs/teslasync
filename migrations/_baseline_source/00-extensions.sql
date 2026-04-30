-- =========================================================================
-- 00 — Extensions
-- ADR-007: timescale/timescaledb-ha:pg17 image bakes these in. CREATE
-- EXTENSION is still required to register them inside the database.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
