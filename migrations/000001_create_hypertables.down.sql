-- Revert hypertables back to regular tables.
--
-- TimescaleDB has no built-in "undo hypertable" command. Reverting requires:
--   1. CREATE TABLE new_table (LIKE old_table INCLUDING ALL)
--   2. INSERT INTO new_table SELECT * FROM old_table
--   3. DROP TABLE old_table
--   4. ALTER TABLE new_table RENAME TO old_table
-- This is complex, lossy (chunks/compression policies dropped), and rarely
-- needed in practice. If you genuinely need to revert, switch the DSN back
-- to vanilla PostgreSQL via Helm values rather than running this down migration.

SELECT 1;  -- no-op placeholder
