-- Fix drives table: allow NULL end_ts for in-progress drives (same as charging_sessions).
-- Also add DEFAULT 0 for duration_min/distance_mi so CREATE omitting them doesn't violate NOT NULL.

ALTER TABLE drives ALTER COLUMN end_ts DROP NOT NULL;
ALTER TABLE drives ALTER COLUMN duration_min SET DEFAULT 0;
ALTER TABLE drives ALTER COLUMN distance_mi SET DEFAULT 0;

COMMENT ON TABLE drives IS 'One row per drive session. end_ts NULL while drive in progress.';
