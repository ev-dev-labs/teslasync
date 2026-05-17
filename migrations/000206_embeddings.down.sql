-- Phase-50 / 0008 — F7 down migration for embeddings tables.
--
-- Drops both phase-50 embeddings tables in dependency-safe order.
-- CASCADE is intentionally omitted: there should be no dependent
-- objects (no FKs target embeddings columns) and a dependency would
-- indicate a future migration that we want to fail loudly rather
-- than silently demolish.
--
-- IMPORTANT: this migration ONLY removes the F7 tables
-- (`embeddings_768`, `embeddings_1536`). The legacy `embeddings`
-- table created by migration 000142 is NOT touched — that table
-- belongs to a different schema lineage and is reverted only by
-- 000142_baseline_typed.down.sql.

BEGIN;

DROP INDEX IF EXISTS embeddings_1536_hnsw_idx;
DROP INDEX IF EXISTS embeddings_1536_expires_idx;
DROP INDEX IF EXISTS embeddings_1536_user_source_idx;
DROP INDEX IF EXISTS embeddings_1536_dedupe_idx;
DROP TABLE IF EXISTS embeddings_1536;

DROP INDEX IF EXISTS embeddings_768_hnsw_idx;
DROP INDEX IF EXISTS embeddings_768_expires_idx;
DROP INDEX IF EXISTS embeddings_768_user_source_idx;
DROP INDEX IF EXISTS embeddings_768_dedupe_idx;
DROP TABLE IF EXISTS embeddings_768;

COMMIT;
