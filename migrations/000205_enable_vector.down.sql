-- Phase-50 / 0008 — F7 down migration for vector extension enablement.
--
-- We deliberately do NOT DROP EXTENSION here. Once the extension is
-- enabled and the `embeddings` / `embeddings_1536` tables have been
-- populated, dropping the extension would orphan the VECTOR-typed
-- columns and refuse the rollback with a dependency error anyway.
--
-- The matching 000206 down migration drops both embeddings tables
-- before this file's down runs (golang-migrate applies down in
-- reverse-numeric order), so by the time we reach this file the
-- extension has no dependent objects and a manual DROP EXTENSION is
-- safe — but it is shared infrastructure (other phase-50 features
-- and any future vector use will need it back), so we keep the
-- extension installed and only document the contract.

-- Intentional no-op. See file header comment for rationale.
SELECT 1;
