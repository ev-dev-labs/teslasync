-- TeslaSync test seed data
-- All string values use single quotes (standard SQL)

-- Motor snapshots with all temperature/current fields
INSERT INTO motor_snapshots (vehicle_id,di_state,di_stator_temp,vehicle_speed,gear,
  di_stator_temp_f,di_stator_temp_rel,di_heatsink_t_f,di_heatsink_t_r,
  di_inverter_t_f,di_inverter_t_r,di_motor_current_f,di_motor_current_r,
  di_v_bat_f,di_v_bat_r,lateral_accel,longitudinal_accel,created_at)
VALUES (1,'standby',35.2,0,'P',34.8,33.5,28.1,27.5,30.2,29.8,0.5,0.3,390.2,390.1,0.01,0.02,NOW());

-- Climate snapshots
INSERT INTO climate_snapshots (vehicle_id,inside_temp,outside_temp,hvac_fan_speed,
  hvac_left_temp_request,hvac_right_temp_request,cabin_overheat_mode,defrost_mode,
  battery_heater_on,hvac_ac_enabled,created_at)
VALUES (1,22.5,18.3,3,21.0,22.0,'FanOnly',false,false,true,NOW());

-- Security events
INSERT INTO security_events (vehicle_id,locked,sentry_mode,door_state,
  fd_window,fp_window,rd_window,rp_window,homelink_nearby,guest_mode,created_at)
VALUES (1,true,true,'ClosedAll','Closed','Closed','Closed','Closed',true,false,NOW());

-- Charging telemetry
INSERT INTO charging_telemetry (vehicle_id,battery_level,soc,charge_state,charge_amps,
  charger_voltage,charger_phases,charge_rate_mph,ac_charging_power,est_battery_range,
  ideal_battery_range,rated_range,energy_remaining,pack_voltage,pack_current,
  time_to_full_charge,charge_limit_soc,created_at)
VALUES (1,80,80.5,'Charging',32,240.5,1,30.5,7.68,250.3,280.1,260.0,55.2,390.5,20.1,2.5,90,NOW());

-- Tire pressure
INSERT INTO tire_pressure_snapshots (vehicle_id,front_left,front_right,rear_left,rear_right,created_at)
VALUES (1,2.9,3.0,2.85,2.95,NOW());
