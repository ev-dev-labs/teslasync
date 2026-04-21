-- Migration 17: Comprehensive telemetry panels
-- Adds columns to motor_snapshots, climate_snapshots, security_events
-- Creates new tables: location_snapshots, media_snapshots, safety_snapshots,
-- user_preference_snapshots, vehicle_config_snapshots, tire_pressure_snapshots,
-- charging_telemetry

-- ============================================================
-- ALTER motor_snapshots: add multi-motor + extended powertrain columns
-- ============================================================
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_torque_actual_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_torque_actual_r DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_torque_actual_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_torque_actual_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_axle_speed_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_axle_speed_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_axle_speed_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_state_f VARCHAR(20);
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_state_rel VARCHAR(20);
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_state_rer VARCHAR(20);
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_stator_temp_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_stator_temp_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_stator_temp_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_heatsink_t_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_heatsink_t_r DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_heatsink_t_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_heatsink_t_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_inverter_t_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_inverter_t_r DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_inverter_t_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_inverter_t_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_motor_current_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_motor_current_r DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_motor_current_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_motor_current_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_v_bat_f DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_v_bat_r DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_v_bat_rel DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_v_bat_rer DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS di_slave_torque_cmd DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS hvil VARCHAR(20);
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS brake_pedal_pos DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS cruise_set_speed DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS drive_rail BOOLEAN;

-- ============================================================
-- ALTER climate_snapshots: add extended HVAC/seat/vent columns
-- ============================================================
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS hvac_ac_enabled BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS hvac_auto_mode VARCHAR(100);
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS hvac_fan_status INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS hvac_steering_wheel_heat_auto BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS hvac_steering_wheel_heat_level INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS climate_keeper_mode VARCHAR(20);
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS cabin_overheat_protection_temp_limit DOUBLE PRECISION;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS defrost_for_preconditioning BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_heater_left INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_heater_right INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_heater_rear_left INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_heater_rear_center INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_heater_rear_right INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS seat_vent_enabled BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS climate_seat_cooling_front_left INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS climate_seat_cooling_front_right INTEGER;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS auto_seat_climate_left BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS auto_seat_climate_right BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS rear_defrost_enabled BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS rear_display_hvac_enabled BOOLEAN;
ALTER TABLE climate_snapshots ADD COLUMN IF NOT EXISTS wiper_heat_enabled BOOLEAN;

-- ============================================================
-- ALTER security_events: add extended security columns
-- ============================================================
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS homelink_device_count INTEGER;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS guest_mode_mobile_access_state VARCHAR(20);
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS driver_seat_occupied BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS center_display VARCHAR(20);
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS speed_limit_mode VARCHAR(20);
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS valet_mode_enabled BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS service_mode BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS current_limit_mph DOUBLE PRECISION;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS paired_phone_key_count INTEGER;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS lights_hazards_active BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS lights_high_beams BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS lights_turn_signal VARCHAR(10);
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS tonneau_position VARCHAR(20);
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS tonneau_open_percent DOUBLE PRECISION;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS tonneau_tent_mode BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS driver_seat_belt BOOLEAN;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS passenger_seat_belt BOOLEAN;

-- ============================================================
-- CREATE location_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS location_snapshots (
    id                      BIGSERIAL PRIMARY KEY,
    vehicle_id              BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    destination_name        VARCHAR(255),
    destination_lat         DOUBLE PRECISION,
    destination_lon         DOUBLE PRECISION,
    origin_lat              DOUBLE PRECISION,
    origin_lon              DOUBLE PRECISION,
    miles_to_arrival        DOUBLE PRECISION,
    minutes_to_arrival      DOUBLE PRECISION,
    route_line              TEXT,
    route_traffic_delay_min DOUBLE PRECISION,
    located_at_home         BOOLEAN,
    located_at_work         BOOLEAN,
    located_at_favorite     BOOLEAN,
    gps_state               VARCHAR(20),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_location_snapshots_vehicle_time ON location_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE media_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS media_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    now_playing_title   VARCHAR(255),
    now_playing_artist  VARCHAR(255),
    now_playing_album   VARCHAR(255),
    now_playing_station VARCHAR(255),
    now_playing_duration INTEGER,
    now_playing_elapsed INTEGER,
    playback_status     VARCHAR(20),
    playback_source     VARCHAR(50),
    audio_volume        INTEGER,
    audio_volume_max    INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_snapshots_vehicle_time ON media_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE safety_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS safety_snapshots (
    id                                  BIGSERIAL PRIMARY KEY,
    vehicle_id                          BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    automatic_blind_spot_camera         BOOLEAN,
    automatic_emergency_braking_off     BOOLEAN,
    blind_spot_collision_warning        VARCHAR(100),
    cruise_follow_distance              VARCHAR(10),
    emergency_lane_departure_avoidance  BOOLEAN,
    forward_collision_warning           VARCHAR(100),
    lane_departure_avoidance            VARCHAR(100),
    speed_limit_warning                 VARCHAR(20),
    pin_to_drive_enabled                BOOLEAN,
    miles_since_reset                   DOUBLE PRECISION,
    self_driving_miles_since_reset      DOUBLE PRECISION,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_snapshots_vehicle_time ON safety_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE user_preference_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preference_snapshots (
    id                          BIGSERIAL PRIMARY KEY,
    vehicle_id                  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    setting_24hr_time           BOOLEAN,
    setting_charge_unit         VARCHAR(10),
    setting_distance_unit       VARCHAR(10),
    setting_temperature_unit    VARCHAR(10),
    setting_tire_pressure_unit  VARCHAR(10),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_pref_snapshots_vehicle_time ON user_preference_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE vehicle_config_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_config_snapshots (
    id                              BIGSERIAL PRIMARY KEY,
    vehicle_id                      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    car_type                        VARCHAR(50),
    trim                            VARCHAR(50),
    exterior_color                  VARCHAR(50),
    roof_color                      VARCHAR(50),
    wheel_type                      VARCHAR(50),
    rear_seat_heaters               VARCHAR(100),
    sunroof_installed               VARCHAR(100),
    efficiency_package              VARCHAR(100),
    europe_vehicle                  BOOLEAN,
    right_hand_drive                BOOLEAN,
    remote_start_enabled            BOOLEAN,
    charge_port                     VARCHAR(20),
    offroad_lightbar_present        BOOLEAN,
    version                         VARCHAR(50),
    vehicle_name                    VARCHAR(100),
    software_update_version         VARCHAR(50),
    software_update_download_pct    INTEGER,
    software_update_install_pct     INTEGER,
    software_update_expected_duration INTEGER,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_config_snapshots_vehicle_time ON vehicle_config_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE tire_pressure_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS tire_pressure_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    front_left      DOUBLE PRECISION,
    front_right     DOUBLE PRECISION,
    rear_left       DOUBLE PRECISION,
    rear_right      DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tire_pressure_snapshots_vehicle_time ON tire_pressure_snapshots (vehicle_id, created_at DESC);

-- ============================================================
-- CREATE charging_telemetry
-- ============================================================
CREATE TABLE IF NOT EXISTS charging_telemetry (
    id                              BIGSERIAL PRIMARY KEY,
    vehicle_id                      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    battery_level                   INTEGER,
    soc                             DOUBLE PRECISION,
    charge_state                    VARCHAR(30),
    detailed_charge_state           VARCHAR(30),
    charge_limit_soc                INTEGER,
    charge_amps                     DOUBLE PRECISION,
    charge_current_request          DOUBLE PRECISION,
    charge_current_request_max      DOUBLE PRECISION,
    charge_enable_request           BOOLEAN,
    charger_voltage                 DOUBLE PRECISION,
    charger_phases                  INTEGER,
    charge_rate_mph                 DOUBLE PRECISION,
    dc_charging_power               DOUBLE PRECISION,
    dc_charging_energy_in           DOUBLE PRECISION,
    ac_charging_power               DOUBLE PRECISION,
    ac_charging_energy_in           DOUBLE PRECISION,
    energy_remaining                DOUBLE PRECISION,
    est_battery_range               DOUBLE PRECISION,
    ideal_battery_range             DOUBLE PRECISION,
    rated_range                     DOUBLE PRECISION,
    pack_voltage                    DOUBLE PRECISION,
    pack_current                    DOUBLE PRECISION,
    charge_port_door_open           BOOLEAN,
    charge_port_latch               VARCHAR(20),
    charge_port_cold_weather_mode   BOOLEAN,
    charging_cable_type             VARCHAR(30),
    fast_charger_present            BOOLEAN,
    fast_charger_type               VARCHAR(30),
    time_to_full_charge             DOUBLE PRECISION,
    estimated_hours_to_charge       DOUBLE PRECISION,
    scheduled_charging_mode         VARCHAR(20),
    scheduled_charging_pending      BOOLEAN,
    preconditioning_enabled         BOOLEAN,
    brick_voltage_max               DOUBLE PRECISION,
    brick_voltage_min               DOUBLE PRECISION,
    num_brick_voltage_max           INTEGER,
    num_brick_voltage_min           INTEGER,
    module_temp_max                 DOUBLE PRECISION,
    module_temp_min                 DOUBLE PRECISION,
    num_module_temp_max             INTEGER,
    num_module_temp_min             INTEGER,
    battery_heater_on               BOOLEAN,
    not_enough_power_to_heat        BOOLEAN,
    bms_state                       VARCHAR(20),
    bms_fullcharge_complete         BOOLEAN,
    dcdc_enable                     BOOLEAN,
    isolation_resistance            DOUBLE PRECISION,
    lifetime_energy_used            DOUBLE PRECISION,
    supercharger_session_trip_planner BOOLEAN,
    powershare_status               VARCHAR(20),
    powershare_type                 VARCHAR(20),
    powershare_stop_reason          VARCHAR(50),
    powershare_hours_left           DOUBLE PRECISION,
    powershare_power_kw             DOUBLE PRECISION,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_charging_telemetry_vehicle_time ON charging_telemetry (vehicle_id, created_at DESC);
