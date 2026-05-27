-- Phase-45 — Operator Confidence batch rollback.
--
-- Reverses 000212 in strict reverse order of creation. Drops are
-- IF EXISTS so a partially-applied up.sql can still be rolled back
-- cleanly.

-- 6. export_jobs columns (drop in reverse add order so a partial
--    rollback never leaves a stranded NOT NULL constraint)
ALTER TABLE export_jobs
    DROP COLUMN IF EXISTS sha256,
    DROP COLUMN IF EXISTS storage_path,
    DROP COLUMN IF EXISTS storage_kind;

-- 5. gdpr_export_artifact
DROP TABLE IF EXISTS gdpr_export_artifact;

-- 4. slow_query_snapshot (hypertable — drop via DROP TABLE which
--    cascades to the chunk schema in TimescaleDB 2.x)
DROP TABLE IF EXISTS slow_query_snapshot;

-- 3. secret_rotation_log
DROP TABLE IF EXISTS secret_rotation_log;

-- 2. schema_fingerprint
DROP TABLE IF EXISTS schema_fingerprint;

-- 1. audit_logs extension (drop the indexes first because the column
--    drop cascades to the partial-index predicates)
DROP INDEX IF EXISTS idx_audit_logs_trace_id;
DROP INDEX IF EXISTS idx_audit_logs_category_ts;

ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS success,
    DROP COLUMN IF EXISTS row_hash,
    DROP COLUMN IF EXISTS prev_row_hash,
    DROP COLUMN IF EXISTS trace_id,
    DROP COLUMN IF EXISTS after_value,
    DROP COLUMN IF EXISTS before_value,
    DROP COLUMN IF EXISTS category;
