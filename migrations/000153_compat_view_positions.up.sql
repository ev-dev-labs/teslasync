-- positions: JSONB signals migration (Phase 1 + compatibility view).
--
-- Adds a `signals` JSONB column alongside the existing typed columns,
-- backfills it from the 9 nullable telemetry fields (odometer, power,
-- ideal_range, rated_range, battery_level, inside_temp, outside_temp,
-- fan_status, is_climate_on), and exposes `v_positions` flattening signals
-- back to column names for Grafana dashboards and ad-hoc SQL.
--
-- The typed columns intentionally remain in place during this phase so
-- legacy dashboards and any external consumers keep working unchanged; a
-- later migration will drop them after all reads have switched to signals
-- / v_positions. The native core columns kept for indexed query access are:
--   latitude, longitude, speed, heading, elevation

ALTER TABLE positions
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_positions_signals
    ON positions USING GIN (signals);

-- Backfill historical rows. jsonb_strip_nulls drops keys whose value is NULL
-- so we don't bloat rows with explicit nulls. The WHERE clause makes the
-- migration idempotent and avoids rewriting already-backfilled rows.
UPDATE positions SET signals = jsonb_strip_nulls(jsonb_build_object(
    'odometer',      odometer,
    'power',         power,
    'ideal_range',   ideal_range,
    'rated_range',   rated_range,
    'battery_level', battery_level,
    'inside_temp',   inside_temp,
    'outside_temp',  outside_temp,
    'fan_status',    fan_status,
    'is_climate_on', is_climate_on
)) WHERE signals = '{}'::jsonb;

-- Compatibility view for external SQL consumers (Grafana, BI, psql).
-- Internal Go code reads the native columns + signals column directly
-- through the position repo and does not depend on this view.
CREATE OR REPLACE VIEW v_positions AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    latitude,
    longitude,
    speed,
    heading,
    elevation,
    -- Signals extracted back to column names
    (signals->>'odometer')::double precision     AS odometer,
    (signals->>'power')::double precision        AS power,
    (signals->>'ideal_range')::double precision  AS ideal_range,
    (signals->>'rated_range')::double precision  AS rated_range,
    (signals->>'battery_level')::int             AS battery_level,
    (signals->>'inside_temp')::double precision  AS inside_temp,
    (signals->>'outside_temp')::double precision AS outside_temp,
    (signals->>'fan_status')::int                AS fan_status,
    (signals->>'is_climate_on')::boolean         AS is_climate_on,
    signals,
    created_at
FROM positions;

COMMENT ON VIEW v_positions IS
    'Compatibility view flattening positions.signals JSONB back to named '
    'columns. For use by Grafana and ad-hoc SQL; Go code reads native '
    'columns and signals directly. See migration 000153 for Phase 1 of the '
    'positions JSONB consolidation; native columns will be dropped in a '
    'later migration after all reads migrate to signals/v_positions.';
