-- Migration 214: Persist completed/skipped onboarding tours (rollback).
--
-- Removes the completed_tours key/value row inserted by 000214_*.up.sql.
-- Symmetric to the up migration, which seeds a single JSONB row (not a
-- wide column) into the typed key/value `settings` table. No constraint or
-- column changes to undo — value_jsonb / the 'jsonb' data_kind were added by
-- 000201 and are shared with the AI settings keys.

BEGIN;

DELETE FROM settings WHERE key = 'completed_tours';

COMMIT;
