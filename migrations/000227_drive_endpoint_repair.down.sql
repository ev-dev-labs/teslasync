-- Restore the revision-2 default and backlog index. Rows already re-resolved at
-- revision 3 keep their corrected labels; they simply stop being distinguishable
-- from revision-2 rows, which is the correct behaviour for a rollback.
DROP INDEX IF EXISTS idx_drives_place_label_stale_v3;
CREATE INDEX IF NOT EXISTS idx_drives_place_label_stale
    ON drives (id DESC)
    WHERE place_label_version < 2;

ALTER TABLE drives ALTER COLUMN place_label_version SET DEFAULT 2;
