-- Migration 217: Grid carbon-intensity diurnal model (Carbon Intelligence).
--
-- Why this table exists
-- ─────────────────────
-- The Carbon Intelligence surface (internal/api/carbon) attributes a real CO2
-- footprint to EACH charging session based on WHEN it charged: grid carbon
-- intensity swings across the day (dirty evening peak, clean midday solar,
-- moderate overnight baseload), so a kWh drawn at 19:00 carries far more CO2
-- than the same kWh drawn at 13:00. This table is the grid model the handler
-- reads to turn "energy at hour H" into "grams CO2 per kWh at hour H".
--
-- Self-hosted-safe by design
-- ──────────────────────────
-- TeslaSync ships self-hosted with no guaranteed internet egress, so the
-- feature must NOT depend on a live grid-intensity API (WattTime, Electricity
-- Maps, National Grid ESO, …). Instead we SEED a sensible, realistic built-in
-- diurnal curve here. A future admin screen can UPDATE these 24 rows to match
-- a user's own utility / region without any code change — the table IS the
-- configurable model. The seed is a generic Northern-Hemisphere shape:
--   * overnight baseload (00:00–05:00) ~245–265 gCO2/kWh  (nuclear + wind),
--   * midday solar trough (11:00–15:00) ~200–225 gCO2/kWh (cheapest, greenest),
--   * evening peak ramp   (18:00–21:00) ~430–500 gCO2/kWh (gas peakers).
-- Values are gCO2 per kWh (well-to-wheel-ish, order-of-magnitude realistic).
--
-- Schema notes
-- ────────────
--   * hour_of_day is the PRIMARY KEY (0..23) with a CHECK so a bad row can
--     never be inserted; there is exactly one intensity per clock hour.
--   * g_co2_per_kwh is DOUBLE PRECISION so an admin can store a fractional,
--     region-specific figure without a migration.
--   * The INSERT ... ON CONFLICT DO NOTHING makes re-running the migration a
--     safe no-op and, crucially, never clobbers an admin's hand-edited rows.

CREATE TABLE IF NOT EXISTS grid_carbon_intensity (
    hour_of_day   SMALLINT         PRIMARY KEY CHECK (hour_of_day BETWEEN 0 AND 23),
    g_co2_per_kwh DOUBLE PRECISION NOT NULL
);

-- Seed the 24-hour built-in diurnal curve. ON CONFLICT DO NOTHING keeps the
-- migration idempotent and preserves any admin edits on re-run.
INSERT INTO grid_carbon_intensity (hour_of_day, g_co2_per_kwh) VALUES
    (0,  260),
    (1,  250),
    (2,  245),
    (3,  245),
    (4,  250),
    (5,  265),
    (6,  300),
    (7,  340),
    (8,  330),
    (9,  280),
    (10, 240),
    (11, 215),
    (12, 200),
    (13, 200),
    (14, 205),
    (15, 225),
    (16, 270),
    (17, 340),
    (18, 430),
    (19, 500),
    (20, 490),
    (21, 450),
    (22, 370),
    (23, 300)
ON CONFLICT (hour_of_day) DO NOTHING;

COMMENT ON TABLE grid_carbon_intensity IS
    'Configurable diurnal grid carbon-intensity model (24 rows, one per clock hour). Read by internal/api/carbon to attribute per-session CO2 by charging hour. Seeded with a realistic built-in curve so the feature works offline; a future admin screen edits these rows.';
COMMENT ON COLUMN grid_carbon_intensity.hour_of_day IS
    'Local clock hour 0..23 (primary key). Intensity is looked up by EXTRACT(HOUR FROM charging_sessions.started_at).';
COMMENT ON COLUMN grid_carbon_intensity.g_co2_per_kwh IS
    'Grams of CO2 attributed per kWh of energy drawn during this hour. Higher = dirtier grid (evening peak); lower = greener (midday solar / overnight baseload).';
