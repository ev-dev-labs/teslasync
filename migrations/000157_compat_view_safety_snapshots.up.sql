-- Compatibility VIEW for safety_snapshots after JSONB consolidation.
--
-- Migrations 000142–000144 moved 8 nullable ADAS/safety telemetry columns
-- (collision warnings, lane departure, cruise follow distance, speed limit
-- warning, blind spot camera, AEB, emergency lane departure avoidance) into
-- a `signals` JSONB column on safety_snapshots and then dropped them. This
-- view flattens `signals` back to individual column names so that external
-- consumers (Grafana driver-assistance panels, ADAS alert dashboards,
-- ad-hoc BI queries, `psql` exploration) keep working without modification.
-- Internal Go code reads the `signals` column directly via
-- hydrateFromSignals and does not depend on this view.
--
-- The native core columns that survived 000144 (pin_to_drive_enabled,
-- miles_since_reset, self_driving_miles_since_reset) are passed through
-- unchanged; the remaining safety signals are extracted from `signals` with
-- the same SQL types they had before the migration.

CREATE OR REPLACE VIEW v_safety_snapshots AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    pin_to_drive_enabled,
    miles_since_reset,
    self_driving_miles_since_reset,
    -- Signals extracted back to column names
    (signals->>'automatic_blind_spot_camera')::boolean        AS automatic_blind_spot_camera,
    (signals->>'automatic_emergency_braking_off')::boolean    AS automatic_emergency_braking_off,
    (signals->>'blind_spot_collision_warning')::boolean       AS blind_spot_collision_warning,
    signals->>'cruise_follow_distance'                        AS cruise_follow_distance,
    (signals->>'emergency_lane_departure_avoidance')::boolean AS emergency_lane_departure_avoidance,
    signals->>'forward_collision_warning'                     AS forward_collision_warning,
    signals->>'lane_departure_avoidance'                      AS lane_departure_avoidance,
    signals->>'speed_limit_warning'                           AS speed_limit_warning,
    signals,
    created_at
FROM safety_snapshots;

COMMENT ON VIEW v_safety_snapshots IS
    'Compatibility view flattening safety_snapshots.signals JSONB back '
    'to named columns. For use by Grafana driver-assistance panels and '
    'ad-hoc SQL; Go code reads signals directly. See migration 000157.';
