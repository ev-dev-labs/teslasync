-- Reverse Phase 40 / Prompt 22: drop the per-vehicle timezone column.
ALTER TABLE vehicles DROP COLUMN IF EXISTS timezone;
