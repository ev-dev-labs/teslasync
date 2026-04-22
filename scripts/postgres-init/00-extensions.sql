-- TimescaleDB + pgvector extension bootstrap.
-- Mirrors helm chart's configmap-postgresql-init.yaml so local docker compose
-- and kubernetes deployments behave identically.
-- This script runs ONCE on a fresh PGDATA volume via /docker-entrypoint-initdb.d.
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS vector CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
