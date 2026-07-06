-- Migration 218: Component lifespans reference table (Remaining Useful Life / RUL).
--
-- Why this table exists
-- ─────────────────────
-- The Remaining Useful Life surface (internal/api/rul) FORECASTS the end-of-life
-- of each wear component — going beyond the AnomalyDashboard / DrivetrainHealth
-- surfaces which only detect issues that are ALREADY present. To turn observed
-- wear rates into a "replace-by" date it needs a per-component nominal service
-- life and an end-of-life threshold. This table is that reference model: one row
-- per component, read by the handler to bound each prognosis.
--
-- Self-hosted-safe by design
-- ──────────────────────────
-- TeslaSync ships self-hosted with no guaranteed internet egress, so the feature
-- must NOT depend on a live manufacturer service-schedule API. Instead we SEED
-- realistic, generic figures here. A future admin screen can UPDATE these rows
-- to match a specific model / driving profile without any code change — the
-- table IS the configurable model. The INSERT ... ON CONFLICT DO NOTHING makes
-- re-running the migration a safe no-op and never clobbers an admin's edits.
--
-- Schema notes
-- ────────────
--   * component is the PRIMARY KEY — a stable machine key (e.g. 'hv_battery')
--     the handler switches on; there is exactly one row per component.
--   * nominal_life_km / nominal_life_days are NULLABLE: distance-wear parts
--     (tires, brakes) carry a km life; calendar-wear parts (12V battery, cabin
--     filter) carry a days life. A component populates whichever applies.
--   * eol_threshold is the health value (in the component's own health unit) at
--     which it is considered end-of-life. For the HV battery this is a % State
--     of Health (70); wear/age parts decay toward a 0% remaining-life floor.
--   * notes is a free-text rationale the detail endpoint echoes to the UI.

CREATE TABLE IF NOT EXISTS component_lifespans (
    component          TEXT PRIMARY KEY,
    nominal_life_km    DOUBLE PRECISION,
    nominal_life_days  INTEGER,
    eol_threshold      DOUBLE PRECISION,
    notes              TEXT
);

-- Seed the built-in component model. ON CONFLICT DO NOTHING keeps the migration
-- idempotent and preserves any admin-edited rows on re-run.
--
--   * hv_battery   — HV traction pack. EOL at 70% State of Health (a common
--                    warranty / usability floor); a Tesla pack is generally
--                    rated well past 300,000 km, hence the km reference.
--   * lv_battery   — 12V low-voltage battery. Calendar-wear part; ~4 years
--                    (1460 days) is a realistic service life.
--   * tires        — Whole-set tread life ~50,000 km for a performance EV.
--   * brakes       — ~150,000 km: EVs spare their friction brakes via regen, so
--                    pads/rotors last far longer than on an ICE car.
--   * cabin_filter — Cabin HVAC filter, replaced roughly yearly (365 days).
INSERT INTO component_lifespans (component, nominal_life_km, nominal_life_days, eol_threshold, notes) VALUES
    ('hv_battery',   300000, NULL, 70, 'High-voltage traction pack. Remaining life fitted from the daily State-of-Health trend; end-of-life at 70% SoH.'),
    ('lv_battery',   NULL,   1460, 0,  '12V low-voltage battery. Age-based estimate from vehicle enrollment vs a ~4-year nominal calendar life.'),
    ('tires',        50000,  NULL, 0,  'Tire tread. Distance-wear estimate from odometer accumulation; whole-life proxy (no per-set reset data).'),
    ('brakes',       150000, NULL, 0,  'Brake pads/rotors. Distance-wear estimate; EVs spare the friction brakes via regenerative braking, so life is long.'),
    ('cabin_filter', NULL,   365,  0,  'Cabin air filter. Age-based estimate from vehicle enrollment vs a ~1-year nominal calendar life.')
ON CONFLICT (component) DO NOTHING;

COMMENT ON TABLE component_lifespans IS
    'Configurable per-component service-life model read by internal/api/rul to forecast Remaining Useful Life. Seeded with realistic built-in figures so the feature works offline; a future admin screen edits these rows.';
COMMENT ON COLUMN component_lifespans.component IS
    'Stable machine key for the component (primary key). The RUL handler switches on this value: hv_battery, lv_battery, tires, brakes, cabin_filter.';
COMMENT ON COLUMN component_lifespans.nominal_life_km IS
    'Nominal service life in kilometres for distance-wear parts (tires, brakes). NULL for calendar-wear parts.';
COMMENT ON COLUMN component_lifespans.nominal_life_days IS
    'Nominal service life in days for calendar-wear parts (12V battery, cabin filter). NULL for distance-wear parts.';
COMMENT ON COLUMN component_lifespans.eol_threshold IS
    'Health value at which the component is end-of-life, in its own health unit. HV battery: percent State of Health (70). Wear/age parts decay toward a 0% remaining-life floor.';
COMMENT ON COLUMN component_lifespans.notes IS
    'Free-text rationale for the figures, echoed to the UI by the per-component detail endpoint.';
