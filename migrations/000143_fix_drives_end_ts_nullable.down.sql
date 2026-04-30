-- Revert: restore NOT NULL on end_ts, remove defaults on duration_min/distance_mi.
UPDATE drives SET end_ts = start_ts WHERE end_ts IS NULL;

ALTER TABLE drives ALTER COLUMN end_ts SET NOT NULL;
ALTER TABLE drives ALTER COLUMN duration_min DROP DEFAULT;
ALTER TABLE drives ALTER COLUMN distance_mi DROP DEFAULT;

COMMENT ON TABLE drives IS 'One row per completed drive. Mutable (re-scoring updates score column).';
