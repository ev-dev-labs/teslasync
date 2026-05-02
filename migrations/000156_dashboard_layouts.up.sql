-- Phase 40 / Prompt 30: dashboard customization completeness.
--
-- Per-row storage for named dashboard layouts (the existing JSON-blob in
-- `settings.dashboard_layouts` is kept for the in-app sync path, this
-- table is the per-row "library" backing the new LayoutSwitcher and the
-- "Save as preset" / "Apply preset" flows in the WidgetPicker).
--
-- Schema notes:
--   - user_id is nullable: TeslaSync ships single-user (admin/UID 1) by
--     default but the column is reserved for future multi-tenancy.
--   - vehicle_id is nullable: NULL means the layout applies to ANY vehicle
--     (the user's "global default"). Non-null pins the layout to a single
--     vehicle so multi-Tesla owners can keep different layouts per car.
--   - is_default: at most one default per (user_id, vehicle_id) tuple; the
--     application layer enforces this with SetDefault — no exclusion
--     constraint here so callers can perform the swap as a single
--     transaction without race-window churn.
--   - layout: the same `SavedDashboard` blob the frontend already
--     produces (widgets[], layouts{}, settings{}). Stored as JSONB so
--     migrations can reach into it later without a full rewrite.
BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id     bigint,
  vehicle_id  bigint,
  name        text   NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  layout      jsonb  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_user_vehicle
  ON dashboard_layouts (user_id, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_default
  ON dashboard_layouts (user_id, vehicle_id)
  WHERE is_default;

COMMENT ON TABLE  dashboard_layouts IS
  'Named dashboard layouts saved by the user. Per-vehicle scope via vehicle_id (NULL = global). Phase 40 / Prompt 30.';
COMMENT ON COLUMN dashboard_layouts.user_id IS
  'Reserved for future multi-tenancy. NULL today (single-user install).';
COMMENT ON COLUMN dashboard_layouts.vehicle_id IS
  'NULL means the layout applies to any vehicle (user-global default).';
COMMENT ON COLUMN dashboard_layouts.layout IS
  'SavedDashboard JSON blob (widgets[], layouts{}, settings{}). Validated on write by the API handler.';

COMMIT;
