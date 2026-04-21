-- Compatibility VIEW for motor_snapshots after JSONB consolidation.
--
-- Migrations 000142–000144 moved 45 nullable drivetrain telemetry columns
-- into a `signals` JSONB column on motor_snapshots and then dropped them.
-- This view flattens `signals` back to individual column names so that
-- external consumers (Grafana motor health panels, ad-hoc BI queries,
-- `psql` exploration) keep working without modification. Internal Go code
-- reads the `signals` column directly via hydrateFromSignals and does not
-- depend on this view.
--
-- The native core columns (di_state, vehicle_speed, gear) are passed
-- through unchanged; all remaining motor signals are extracted from
-- `signals` with the same SQL types they had before the migration.
--
-- Columns flattened here cover: drive-inverter state/torque/axle-speed
-- (global + front/rear/REL/RER variants), stator/heatsink/inverter
-- temperatures, motor currents, bus voltages, pedal/brake/cruise inputs,
-- accelerometers, HVIL interlock, drive rail, and lifetime energy
-- counters — the full set of telemetry originally carried by the wide
-- motor_snapshots table.

CREATE OR REPLACE VIEW v_motor_snapshots AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    di_state,
    vehicle_speed,
    gear,
    -- Signals extracted back to column names
    (signals->>'di_torque')::double precision                      AS di_torque,
    (signals->>'di_axle_speed')::double precision                  AS di_axle_speed,
    (signals->>'di_stator_temp')::double precision                 AS di_stator_temp,
    (signals->>'pedal_position')::double precision                 AS pedal_position,
    (signals->>'brake_pedal')::boolean                             AS brake_pedal,
    (signals->>'lateral_accel')::double precision                  AS lateral_accel,
    (signals->>'longitudinal_accel')::double precision             AS longitudinal_accel,
    (signals->>'di_torque_actual_f')::double precision             AS di_torque_actual_f,
    (signals->>'di_torque_actual_r')::double precision             AS di_torque_actual_r,
    (signals->>'di_torque_actual_rel')::double precision           AS di_torque_actual_rel,
    (signals->>'di_torque_actual_rer')::double precision           AS di_torque_actual_rer,
    (signals->>'di_axle_speed_f')::double precision                AS di_axle_speed_f,
    (signals->>'di_axle_speed_rel')::double precision              AS di_axle_speed_rel,
    (signals->>'di_axle_speed_rer')::double precision              AS di_axle_speed_rer,
    signals->>'di_state_f'                                         AS di_state_f,
    signals->>'di_state_rel'                                       AS di_state_rel,
    signals->>'di_state_rer'                                       AS di_state_rer,
    (signals->>'di_stator_temp_f')::double precision               AS di_stator_temp_f,
    (signals->>'di_stator_temp_rel')::double precision             AS di_stator_temp_rel,
    (signals->>'di_stator_temp_rer')::double precision             AS di_stator_temp_rer,
    (signals->>'di_heatsink_t_f')::double precision                AS di_heatsink_t_f,
    (signals->>'di_heatsink_t_r')::double precision                AS di_heatsink_t_r,
    (signals->>'di_heatsink_t_rel')::double precision              AS di_heatsink_t_rel,
    (signals->>'di_heatsink_t_rer')::double precision              AS di_heatsink_t_rer,
    (signals->>'di_inverter_t_f')::double precision                AS di_inverter_t_f,
    (signals->>'di_inverter_t_r')::double precision                AS di_inverter_t_r,
    (signals->>'di_inverter_t_rel')::double precision              AS di_inverter_t_rel,
    (signals->>'di_inverter_t_rer')::double precision              AS di_inverter_t_rer,
    (signals->>'di_motor_current_f')::double precision             AS di_motor_current_f,
    (signals->>'di_motor_current_r')::double precision             AS di_motor_current_r,
    (signals->>'di_motor_current_rel')::double precision           AS di_motor_current_rel,
    (signals->>'di_motor_current_rer')::double precision           AS di_motor_current_rer,
    (signals->>'di_v_bat_f')::double precision                     AS di_v_bat_f,
    (signals->>'di_v_bat_r')::double precision                     AS di_v_bat_r,
    (signals->>'di_v_bat_rel')::double precision                   AS di_v_bat_rel,
    (signals->>'di_v_bat_rer')::double precision                   AS di_v_bat_rer,
    (signals->>'di_slave_torque_cmd')::double precision            AS di_slave_torque_cmd,
    signals->>'hvil'                                               AS hvil,
    (signals->>'brake_pedal_pos')::double precision                AS brake_pedal_pos,
    (signals->>'cruise_set_speed')::double precision               AS cruise_set_speed,
    (signals->>'drive_rail')::boolean                              AS drive_rail,
    (signals->>'lifetime_energy_gained_regen')::double precision   AS lifetime_energy_gained_regen,
    (signals->>'lifetime_energy_used_drive')::double precision     AS lifetime_energy_used_drive,
    signals,
    created_at
FROM motor_snapshots;

COMMENT ON VIEW v_motor_snapshots IS
    'Compatibility view flattening motor_snapshots.signals JSONB back to '
    'named columns. For use by Grafana motor health panels and ad-hoc SQL; '
    'Go code reads signals directly. See migration 000154.';
