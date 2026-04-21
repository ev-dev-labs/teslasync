-- Compatibility VIEW for charging_telemetry after JSONB consolidation.
--
-- Migrations 000142–000144 moved 51 nullable columns into a `signals` JSONB
-- column on charging_telemetry and then dropped them. This view flattens
-- `signals` back to individual column names so that external consumers
-- (Grafana dashboards, ad-hoc BI queries, `psql` exploration) keep working
-- without modification. Internal Go code reads the `signals` column directly
-- via hydrateFromSignals and does not depend on this view.
--
-- The native core columns (battery_level, charge_state, charger_voltage,
-- charge_rate_mph, dc_charging_power, time_to_full_charge) are passed through
-- unchanged; all remaining charging signals are extracted from `signals`
-- with the same SQL types they had before the migration.

CREATE OR REPLACE VIEW v_charging_telemetry AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    battery_level,
    charge_state,
    charger_voltage,
    charge_rate_mph,
    dc_charging_power,
    time_to_full_charge,
    -- Signals extracted back to column names
    (signals->>'soc')::double precision                         AS soc,
    signals->>'detailed_charge_state'                           AS detailed_charge_state,
    (signals->>'charge_limit_soc')::int                         AS charge_limit_soc,
    (signals->>'charge_amps')::double precision                 AS charge_amps,
    (signals->>'charge_current_request')::double precision      AS charge_current_request,
    (signals->>'charge_current_request_max')::double precision  AS charge_current_request_max,
    (signals->>'charge_enable_request')::boolean                AS charge_enable_request,
    (signals->>'charger_phases')::int                           AS charger_phases,
    (signals->>'dc_charging_energy_in')::double precision       AS dc_charging_energy_in,
    (signals->>'ac_charging_power')::double precision           AS ac_charging_power,
    (signals->>'ac_charging_energy_in')::double precision       AS ac_charging_energy_in,
    (signals->>'energy_remaining')::double precision            AS energy_remaining,
    (signals->>'est_battery_range')::double precision           AS est_battery_range,
    (signals->>'ideal_battery_range')::double precision         AS ideal_battery_range,
    (signals->>'rated_range')::double precision                 AS rated_range,
    (signals->>'pack_voltage')::double precision                AS pack_voltage,
    (signals->>'pack_current')::double precision                AS pack_current,
    signals->>'charge_port'                                     AS charge_port,
    (signals->>'charge_port_door_open')::boolean                AS charge_port_door_open,
    signals->>'charge_port_latch'                               AS charge_port_latch,
    (signals->>'charge_port_cold_weather_mode')::boolean        AS charge_port_cold_weather_mode,
    signals->>'charging_cable_type'                             AS charging_cable_type,
    (signals->>'fast_charger_present')::boolean                 AS fast_charger_present,
    signals->>'fast_charger_type'                               AS fast_charger_type,
    (signals->>'estimated_hours_to_charge')::double precision   AS estimated_hours_to_charge,
    signals->>'scheduled_charging_mode'                         AS scheduled_charging_mode,
    (signals->>'scheduled_charging_pending')::boolean           AS scheduled_charging_pending,
    (signals->>'preconditioning_enabled')::boolean              AS preconditioning_enabled,
    (signals->>'brick_voltage_max')::double precision           AS brick_voltage_max,
    (signals->>'brick_voltage_min')::double precision           AS brick_voltage_min,
    (signals->>'num_brick_voltage_max')::int                    AS num_brick_voltage_max,
    (signals->>'num_brick_voltage_min')::int                    AS num_brick_voltage_min,
    (signals->>'module_temp_max')::double precision             AS module_temp_max,
    (signals->>'module_temp_min')::double precision             AS module_temp_min,
    (signals->>'num_module_temp_max')::int                      AS num_module_temp_max,
    (signals->>'num_module_temp_min')::int                      AS num_module_temp_min,
    (signals->>'battery_heater_on')::boolean                    AS battery_heater_on,
    (signals->>'not_enough_power_to_heat')::boolean             AS not_enough_power_to_heat,
    signals->>'bms_state'                                       AS bms_state,
    (signals->>'bms_fullcharge_complete')::boolean              AS bms_fullcharge_complete,
    (signals->>'dcdc_enable')::boolean                          AS dcdc_enable,
    (signals->>'isolation_resistance')::double precision        AS isolation_resistance,
    (signals->>'lifetime_energy_used')::double precision        AS lifetime_energy_used,
    (signals->>'supercharger_session_trip_planner')::boolean    AS supercharger_session_trip_planner,
    signals->>'powershare_status'                               AS powershare_status,
    signals->>'powershare_type'                                 AS powershare_type,
    signals->>'powershare_stop_reason'                          AS powershare_stop_reason,
    (signals->>'powershare_hours_left')::double precision       AS powershare_hours_left,
    (signals->>'powershare_power_kw')::double precision         AS powershare_power_kw,
    signals->>'scheduled_charging_start_time'                   AS scheduled_charging_start_time,
    signals->>'scheduled_departure_time'                        AS scheduled_departure_time,
    (signals->>'expected_energy_pct_at_arrival')::double precision AS expected_energy_pct_at_arrival,
    signals,
    created_at
FROM charging_telemetry;

COMMENT ON VIEW v_charging_telemetry IS
    'Compatibility view flattening charging_telemetry.signals JSONB back to named '
    'columns. For use by Grafana and ad-hoc SQL; Go code reads the signals column '
    'directly. See migrations 000142-000144 for the column->JSONB migration.';
