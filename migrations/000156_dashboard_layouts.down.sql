-- Reverse migration 000156: drop named-layout library table.
BEGIN;

DROP INDEX IF EXISTS idx_dashboard_layouts_default;
DROP INDEX IF EXISTS idx_dashboard_layouts_user_vehicle;
DROP TABLE IF EXISTS dashboard_layouts;

COMMIT;
