-- Phase 40 / Prompt 43: chart annotation persistence.
--
-- Tesla owners want to mark hardware/software events on time-series charts
-- (battery replacement, software update, tire change, service visit). Until
-- now annotations lived in localStorage which doesn't survive a device swap
-- and isn't shared across browsers. This table is the durable home.
--
-- Schema notes:
--   - user_id is reserved for future multi-tenancy. NULL today.
--   - vehicle_id is nullable: NULL means the annotation applies to any vehicle
--     (a fleet-wide event such as a utility-rate change). Non-null pins it
--     to a single vehicle.
--   - category bounds the icon + default colour the UI picks. The list mirrors
--     the existing AnnotationCategory union in web/src/types/annotations.ts.
--   - scope is a TEXT[] of chart "buckets" (battery, efficiency, cost, tire,
--     energy, drivetrain, mileage, charging). An empty array means the
--     annotation appears on every chart that opts into annotations.
--   - color is optional — when NULL the UI falls back to the category default.
BEGIN;

CREATE TABLE IF NOT EXISTS chart_annotations (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id      bigint,
  vehicle_id   bigint REFERENCES vehicles(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  category     text NOT NULL CHECK (category IN ('milestone','maintenance','trip','issue','upgrade','custom')),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description  text,
  scope        text[] NOT NULL DEFAULT '{}'::text[],
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_annotations_vehicle_time
  ON chart_annotations (vehicle_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_chart_annotations_user
  ON chart_annotations (user_id);

CREATE INDEX IF NOT EXISTS idx_chart_annotations_scope
  ON chart_annotations USING GIN (scope);

COMMENT ON TABLE  chart_annotations IS
  'User-authored event markers rendered on time-series charts. Phase 40 / Prompt 43.';
COMMENT ON COLUMN chart_annotations.user_id IS
  'Reserved for future multi-tenancy. NULL today (single-user install).';
COMMENT ON COLUMN chart_annotations.vehicle_id IS
  'NULL means the annotation applies to any vehicle (fleet-wide event).';
COMMENT ON COLUMN chart_annotations.scope IS
  'Chart buckets the annotation belongs to. Empty array = visible on every chart.';

COMMIT;
