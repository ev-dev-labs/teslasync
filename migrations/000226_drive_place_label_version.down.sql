DROP INDEX IF EXISTS idx_drives_place_label_stale;
ALTER TABLE drives DROP COLUMN IF EXISTS place_label_version;
