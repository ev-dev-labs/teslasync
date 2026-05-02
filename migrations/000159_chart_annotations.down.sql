-- Reverse migration 000159: drop chart annotations table.
BEGIN;

DROP INDEX IF EXISTS idx_chart_annotations_scope;
DROP INDEX IF EXISTS idx_chart_annotations_user;
DROP INDEX IF EXISTS idx_chart_annotations_vehicle_time;
DROP TABLE IF EXISTS chart_annotations;

COMMIT;
