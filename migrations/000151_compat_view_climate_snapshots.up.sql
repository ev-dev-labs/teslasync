-- Compatibility VIEW for climate_snapshots after JSONB consolidation.
--
-- Migrations 000142–000144 moved 25 nullable columns into a `signals` JSONB
-- column on climate_snapshots and then dropped them. This view flattens
-- `signals` back to individual column names so that external consumers
-- (Grafana temperature dashboards, ad-hoc BI queries, `psql` exploration)
-- keep working without modification. Internal Go code reads the `signals`
-- column directly via hydrateFromSignals and does not depend on this view.
--
-- The native core columns (inside_temp, outside_temp, hvac_fan_speed,
-- hvac_ac_enabled, hvac_auto_mode) are passed through unchanged; all
-- remaining climate signals are extracted from `signals` with the same
-- SQL types they had before the migration.

CREATE OR REPLACE VIEW v_climate_snapshots AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    inside_temp,
    outside_temp,
    hvac_fan_speed,
    hvac_ac_enabled,
    hvac_auto_mode,
    -- Signals extracted back to column names
    (signals->>'hvac_power')::double precision                  AS hvac_power,
    (signals->>'hvac_left_temp_request')::double precision      AS hvac_left_temp_request,
    (signals->>'hvac_right_temp_request')::double precision     AS hvac_right_temp_request,
    signals->>'cabin_overheat_mode'                             AS cabin_overheat_mode,
    signals->>'defrost_mode'                                    AS defrost_mode,
    (signals->>'battery_heater_on')::boolean                    AS battery_heater_on,
    (signals->>'hvac_fan_status')::int                          AS hvac_fan_status,
    (signals->>'hvac_steering_wheel_heat_auto')::boolean        AS hvac_steering_wheel_heat_auto,
    (signals->>'hvac_steering_wheel_heat_level')::int           AS hvac_steering_wheel_heat_level,
    signals->>'climate_keeper_mode'                             AS climate_keeper_mode,
    signals->>'cabin_overheat_protection_temp_limit'            AS cabin_overheat_protection_temp_limit,
    (signals->>'defrost_for_preconditioning')::boolean          AS defrost_for_preconditioning,
    (signals->>'seat_heater_left')::int                         AS seat_heater_left,
    (signals->>'seat_heater_right')::int                        AS seat_heater_right,
    (signals->>'seat_heater_rear_left')::int                    AS seat_heater_rear_left,
    (signals->>'seat_heater_rear_center')::int                  AS seat_heater_rear_center,
    (signals->>'seat_heater_rear_right')::int                   AS seat_heater_rear_right,
    (signals->>'seat_vent_enabled')::boolean                    AS seat_vent_enabled,
    (signals->>'climate_seat_cooling_front_left')::int          AS climate_seat_cooling_front_left,
    (signals->>'climate_seat_cooling_front_right')::int         AS climate_seat_cooling_front_right,
    (signals->>'auto_seat_climate_left')::boolean               AS auto_seat_climate_left,
    (signals->>'auto_seat_climate_right')::boolean              AS auto_seat_climate_right,
    (signals->>'rear_defrost_enabled')::boolean                 AS rear_defrost_enabled,
    (signals->>'rear_display_hvac_enabled')::boolean            AS rear_display_hvac_enabled,
    (signals->>'wiper_heat_enabled')::boolean                   AS wiper_heat_enabled,
    signals,
    created_at
FROM climate_snapshots;

COMMENT ON VIEW v_climate_snapshots IS
    'Compatibility view flattening climate_snapshots.signals JSONB back to named '
    'columns. For use by Grafana and ad-hoc SQL; Go code reads the signals column '
    'directly. See migrations 000142-000144 for the column->JSONB migration.';
