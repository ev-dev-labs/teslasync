DROP VIEW IF EXISTS v_positions;
DROP INDEX IF EXISTS idx_positions_signals;
ALTER TABLE positions DROP COLUMN IF EXISTS signals;
