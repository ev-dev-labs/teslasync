-- Compatibility VIEW for tire_pressure_snapshots after JSONB consolidation.
--
-- Migrations 000142–000144 moved 6 nullable tire-pressure telemetry columns
-- (TPMS warnings and per-wheel last-seen timestamps) into a `signals` JSONB
-- column on tire_pressure_snapshots and then dropped them. This view flattens
-- `signals` back to individual column names so that external consumers
-- (Grafana tire pressure panels, TPMS alert dashboards, ad-hoc BI queries,
-- `psql` exploration) keep working without modification. Internal Go code
-- reads the `signals` column directly via hydrateFromSignals and does not
-- depend on this view.
--
-- The native core columns (front_left, front_right, rear_left, rear_right)
-- are passed through unchanged; the remaining tire-pressure signals are
-- extracted from `signals` with the same SQL types they had before the
-- migration.

CREATE OR REPLACE VIEW v_tire_pressure_snapshots AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    front_left,
    front_right,
    rear_left,
    rear_right,
    -- Signals extracted back to column names
    signals->>'tpms_hard_warnings'                   AS tpms_hard_warnings,
    signals->>'tpms_soft_warnings'                   AS tpms_soft_warnings,
    (signals->>'last_seen_time_fl')::timestamptz     AS last_seen_time_fl,
    (signals->>'last_seen_time_fr')::timestamptz     AS last_seen_time_fr,
    (signals->>'last_seen_time_rl')::timestamptz     AS last_seen_time_rl,
    (signals->>'last_seen_time_rr')::timestamptz     AS last_seen_time_rr,
    signals,
    created_at
FROM tire_pressure_snapshots;

COMMENT ON VIEW v_tire_pressure_snapshots IS
    'Compatibility view flattening tire_pressure_snapshots.signals JSONB back '
    'to named columns. For use by Grafana tire pressure panels and ad-hoc SQL; '
    'Go code reads signals directly. See migration 000155.';
