-- Migration 000044 DOWN: Recreate legacy snapshot tables (rollback safety net)
-- Schemas reconstructed from migrations 000016, 000017, 000021, 000026, 000027,
-- 000028, 000041, and 000142_baseline_typed.
-- Column types reflect final widened values from migration 000026 and type
-- fixes from 000041.

-- ============================================================================
-- 1. motor_snapshots (000016 + 000017 ALTERs + 000026 widens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS motor_snapshots (
    id                    BIGSERIAL PRIMARY KEY,
    vehicle_id            BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    di_state              VARCHAR(50),
    di_torque             DOUBLE PRECISION,
    di_axle_speed         DOUBLE PRECISION,
    di_stator_temp        DOUBLE PRECISION,
    pedal_position        DOUBLE PRECISION,
    brake_pedal           BOOLEAN,
    lateral_accel         DOUBLE PRECISION,
    longitudinal_accel    DOUBLE PRECISION,
    vehicle_speed         DOUBLE PRECISION,
    gear                  VARCHAR(30),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 000017 expanded telemetry
    di_torque_actual_f    DOUBLE PRECISION,
    di_torque_actual_r    DOUBLE PRECISION,
    di_torque_actual_rel  DOUBLE PRECISION,
    di_torque_actual_rer  DOUBLE PRECISION,
    di_axle_speed_f       DOUBLE PRECISION,
    di_axle_speed_rel     DOUBLE PRECISION,
    di_axle_speed_rer     DOUBLE PRECISION,
    di_state_f            VARCHAR(50),
    di_state_rel          VARCHAR(50),
    di_state_rer          VARCHAR(50),
    di_stator_temp_f      DOUBLE PRECISION,
    di_stator_temp_rel    DOUBLE PRECISION,
    di_stator_temp_rer    DOUBLE PRECISION,
    di_heatsink_t_f       DOUBLE PRECISION,
    di_heatsink_t_r       DOUBLE PRECISION,
    di_heatsink_t_rel     DOUBLE PRECISION,
    di_heatsink_t_rer     DOUBLE PRECISION,
    di_inverter_t_f       DOUBLE PRECISION,
    di_inverter_t_r       DOUBLE PRECISION,
    di_inverter_t_rel     DOUBLE PRECISION,
    di_inverter_t_rer     DOUBLE PRECISION,
    di_motor_current_f    DOUBLE PRECISION,
    di_motor_current_r    DOUBLE PRECISION,
    di_motor_current_rel  DOUBLE PRECISION,
    di_motor_current_rer  DOUBLE PRECISION,
    di_v_bat_f            DOUBLE PRECISION,
    di_v_bat_r            DOUBLE PRECISION,
    di_v_bat_rel          DOUBLE PRECISION,
    di_v_bat_rer          DOUBLE PRECISION,
    di_slave_torque_cmd   DOUBLE PRECISION,
    hvil                  VARCHAR(50),
    brake_pedal_pos       DOUBLE PRECISION,
    cruise_set_speed      DOUBLE PRECISION,
    drive_rail            BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_motor_snapshots_vehicle_time
    ON motor_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 2. climate_snapshots (000016 + 000017 ALTERs + 000026 widens + 000041 fix)
-- ============================================================================
CREATE TABLE IF NOT EXISTS climate_snapshots (
    id                                    BIGSERIAL PRIMARY KEY,
    vehicle_id                            BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    inside_temp                           DOUBLE PRECISION,
    outside_temp                          DOUBLE PRECISION,
    hvac_power                            DOUBLE PRECISION,
    hvac_fan_speed                        INTEGER,
    hvac_left_temp_request                DOUBLE PRECISION,
    hvac_right_temp_request               DOUBLE PRECISION,
    cabin_overheat_mode                   VARCHAR(50),
    defrost_mode                          VARCHAR(50),
    battery_heater_on                     BOOLEAN,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 000017 expanded telemetry
    hvac_ac_enabled                       BOOLEAN,
    hvac_auto_mode                        VARCHAR(50),
    hvac_fan_status                       INTEGER,
    hvac_steering_wheel_heat_auto         BOOLEAN,
    hvac_steering_wheel_heat_level        INTEGER,
    climate_keeper_mode                   VARCHAR(50),
    cabin_overheat_protection_temp_limit  VARCHAR(60),
    defrost_for_preconditioning           BOOLEAN,
    seat_heater_left                      INTEGER,
    seat_heater_right                     INTEGER,
    seat_heater_rear_left                 INTEGER,
    seat_heater_rear_center               INTEGER,
    seat_heater_rear_right                INTEGER,
    seat_vent_enabled                     BOOLEAN,
    climate_seat_cooling_front_left       INTEGER,
    climate_seat_cooling_front_right      INTEGER,
    auto_seat_climate_left                BOOLEAN,
    auto_seat_climate_right               BOOLEAN,
    rear_defrost_enabled                  BOOLEAN,
    rear_display_hvac_enabled             BOOLEAN,
    wiper_heat_enabled                    BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_climate_snapshots_vehicle_time
    ON climate_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 3. location_snapshots (000017 + 000026 widen + 000028/000041 ALTERs)
-- ============================================================================
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
    gps_state               VARCHAR(50),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 000028/000041
    route_last_updated      VARCHAR(100),
    current_lat             DOUBLE PRECISION,
    current_lon             DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_location_snapshots_vehicle_time
    ON location_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 4. safety_snapshots (000017 + 000026 widens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS safety_snapshots (
    id                                  BIGSERIAL PRIMARY KEY,
    vehicle_id                          BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    automatic_blind_spot_camera         BOOLEAN,
    automatic_emergency_braking_off     BOOLEAN,
    blind_spot_collision_warning        BOOLEAN,
    cruise_follow_distance              VARCHAR(50),
    emergency_lane_departure_avoidance  BOOLEAN,
    forward_collision_warning           VARCHAR(20),
    lane_departure_avoidance            VARCHAR(20),
    speed_limit_warning                 VARCHAR(50),
    pin_to_drive_enabled                BOOLEAN,
    miles_since_reset                   DOUBLE PRECISION,
    self_driving_miles_since_reset      DOUBLE PRECISION,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_snapshots_vehicle_time
    ON safety_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 5. battery_snapshots (root 000002)
-- ============================================================================
CREATE TABLE IF NOT EXISTS battery_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    health_score    DOUBLE PRECISION NOT NULL DEFAULT 100,
    capacity_kwh    DOUBLE PRECISION NOT NULL DEFAULT 0,
    degradation_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    est_range_km    DOUBLE PRECISION NOT NULL DEFAULT 0,
    cycle_count     INTEGER NOT NULL DEFAULT 0,
    avg_cell_temp_c DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_battery_snapshots_vehicle
    ON battery_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 6. tire_pressure_snapshots (root 000003 + 000017 ALTERs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tire_pressure_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    front_left    DOUBLE PRECISION,
    front_right   DOUBLE PRECISION,
    rear_left     DOUBLE PRECISION,
    rear_right    DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 000017
    hard_warnings VARCHAR(50),
    soft_warnings VARCHAR(50),
    last_seen_fl  TIMESTAMPTZ,
    last_seen_fr  TIMESTAMPTZ,
    last_seen_rl  TIMESTAMPTZ,
    last_seen_rr  TIMESTAMPTZ
);

-- ============================================================================
-- 7. user_preference_snapshots (000017 + 000026 widens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_preference_snapshots (
    id                         BIGSERIAL PRIMARY KEY,
    vehicle_id                 BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    setting_24hr_time          BOOLEAN,
    setting_charge_unit        VARCHAR(50),
    setting_distance_unit      VARCHAR(50),
    setting_temperature_unit   VARCHAR(50),
    setting_tire_pressure_unit VARCHAR(50),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_pref_vehicle_time
    ON user_preference_snapshots (vehicle_id, created_at DESC);

-- ============================================================================
-- 8. vehicle_meta_snapshots (000142 baseline_typed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicle_meta_snapshots (
    vehicle_id                bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    ts                        timestamptz NOT NULL,
    category                  text NOT NULL
                              CHECK (category IN ('tire','media','safety','config','preference')),
    -- Tire
    tire_pressure_fl_psi      double precision,
    tire_pressure_fr_psi      double precision,
    tire_pressure_rl_psi      double precision,
    tire_pressure_rr_psi      double precision,
    tire_temp_fl_c            double precision,
    tire_temp_fr_c            double precision,
    tire_temp_rl_c            double precision,
    tire_temp_rr_c            double precision,
    -- Media
    media_source              text,
    media_track_title         text,
    media_track_artist        text,
    media_track_album         text,
    media_volume              double precision,
    media_is_playing          boolean,
    media_track_duration_sec  integer,
    -- Safety
    autopilot_state           text,
    fcw_active                boolean,
    blind_spot_active         boolean,
    emergency_lane_assist     boolean,
    abs_active                boolean,
    speed_limit_mode          text,
    -- Config
    software_version          text,
    car_type                  text,
    exterior_color            text,
    wheel_type                text,
    spoiler_type              text,
    has_ludicrous_mode        boolean,
    -- Preference
    drive_mode                text,
    regen_level               text,
    steering_mode             text,
    acceleration_mode         text,
    climate_keeper_mode       text,
    pet_mode                  boolean,
    source                    text NOT NULL DEFAULT 'fleet_telemetry'
                              CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
    PRIMARY KEY (vehicle_id, ts, category)
);
CREATE INDEX IF NOT EXISTS idx_vmeta_vehicle_cat_ts
    ON vehicle_meta_snapshots (vehicle_id, category, ts DESC);

-- ============================================================================
-- 9. vehicle_live_state (000027 + 000028 + 000041 type fixes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicle_live_state (
    vehicle_id                                  BIGINT PRIMARY KEY REFERENCES vehicles(id),

    -- Location
    latitude                                    DOUBLE PRECISION,
    longitude                                   DOUBLE PRECISION,
    heading                                     INTEGER,
    gps_state                                   BOOLEAN,

    -- Driving
    speed                                       DOUBLE PRECISION,
    power                                       DOUBLE PRECISION,
    odometer                                    DOUBLE PRECISION,
    gear                                        VARCHAR(50),
    pedal_position                              DOUBLE PRECISION,
    brake_pedal                                 BOOLEAN,

    -- Battery / Range
    battery_level                               INTEGER,
    soc                                         DOUBLE PRECISION,
    ideal_range                                 DOUBLE PRECISION,
    rated_range                                 DOUBLE PRECISION,
    est_range                                   DOUBLE PRECISION,
    energy_remaining                            DOUBLE PRECISION,

    -- Climate
    inside_temp                                 DOUBLE PRECISION,
    outside_temp                                DOUBLE PRECISION,
    hvac_power                                  BOOLEAN,
    fan_speed                                   INTEGER,
    is_climate_on                               BOOLEAN,

    -- Charging
    charge_state                                VARCHAR(50),
    detailed_charge_state                       VARCHAR(50),
    charger_voltage                             DOUBLE PRECISION,
    charge_amps                                 DOUBLE PRECISION,
    charge_rate                                 DOUBLE PRECISION,
    charger_power                               DOUBLE PRECISION,
    charge_limit_soc                            INTEGER,
    time_to_full_charge                         DOUBLE PRECISION,
    charging_cable_type                         VARCHAR(50),

    -- Security
    locked                                      BOOLEAN,
    sentry_mode                                 BOOLEAN,
    door_state                                  VARCHAR(100),
    fd_window                                   VARCHAR(50),
    fp_window                                   VARCHAR(50),
    rd_window                                   VARCHAR(50),
    rp_window                                   VARCHAR(50),
    center_display                              VARCHAR(50),

    -- Tire Pressure
    tire_pressure_fl                            DOUBLE PRECISION,
    tire_pressure_fr                            DOUBLE PRECISION,
    tire_pressure_rl                            DOUBLE PRECISION,
    tire_pressure_rr                            DOUBLE PRECISION,

    -- Vehicle Info
    vehicle_name                                VARCHAR(100),
    car_type                                    VARCHAR(50),
    version                                     VARCHAR(50),
    wheel_type                                  VARCHAR(50),
    exterior_color                              VARCHAR(50),

    -- Timestamps
    updated_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- === 000028: Security / Vehicle Access ===
    guest_mode                                  BOOLEAN,
    guest_mode_mobile_access                    VARCHAR(50),
    homelink_nearby                             BOOLEAN,
    homelink_device_count                       INTEGER,
    driver_seat_occupied                        BOOLEAN,
    speed_limit_mode                            VARCHAR(50),
    valet_mode_enabled                          BOOLEAN,
    service_mode                                BOOLEAN,
    current_limit_mph                           DOUBLE PRECISION,
    paired_phone_key_count                      INTEGER,
    lights_hazards_active                       BOOLEAN,
    lights_high_beams                           BOOLEAN,
    lights_turn_signal                          VARCHAR(50),

    -- === 000028: Software Update ===
    sw_update_version                           VARCHAR(100),
    sw_update_download_pct                      INTEGER,
    sw_update_install_pct                       INTEGER,
    sw_update_expected_duration                 INTEGER,
    sw_update_scheduled_start                   VARCHAR(100),

    -- === 000028: State Machine ===
    last_gear                                   VARCHAR(30),
    last_speed_time                             TIMESTAMPTZ,

    -- === 000028: Vehicle Configuration ===
    trim                                        VARCHAR(50),
    roof_color                                  VARCHAR(50),
    efficiency_package                          VARCHAR(50),
    rear_seat_heaters                           INTEGER,
    sunroof_installed                           BOOLEAN,
    europe_vehicle                              BOOLEAN,
    right_hand_drive                            BOOLEAN,
    remote_start_enabled                        BOOLEAN,
    offroad_lightbar_present                    BOOLEAN,

    -- === 000028: Charging Extended ===
    ac_charging_energy_in                       DOUBLE PRECISION,
    charge_current_request                      DOUBLE PRECISION,
    charge_current_request_max                  DOUBLE PRECISION,
    charge_enable_request                       BOOLEAN,
    charge_port                                 VARCHAR(50),
    charge_port_cold_weather_mode               BOOLEAN,
    charge_port_door_open                       BOOLEAN,
    charge_port_latch                           VARCHAR(50),
    charger_phases                              INTEGER,
    dc_charging_energy_in                       DOUBLE PRECISION,
    estimated_hours_to_charge_termination       DOUBLE PRECISION,
    fast_charger_present                        BOOLEAN,
    fast_charger_type                           VARCHAR(50),
    scheduled_charging_mode                     VARCHAR(50),
    scheduled_charging_pending                  BOOLEAN,
    scheduled_charging_start_time               VARCHAR(50),
    scheduled_departure_time                    VARCHAR(50),
    supercharger_session_trip_planner           VARCHAR(100),

    -- === 000028: Motor / Powertrain ===
    brake_pedal_pos                             DOUBLE PRECISION,
    dcdc_enable                                 BOOLEAN,
    di_axle_speed_f                             DOUBLE PRECISION,
    di_axle_speed_r                             DOUBLE PRECISION,
    di_axle_speed_rel                           DOUBLE PRECISION,
    di_axle_speed_rer                           DOUBLE PRECISION,
    di_heatsink_tf                              DOUBLE PRECISION,
    di_heatsink_tr                              DOUBLE PRECISION,
    di_heatsink_trel                            DOUBLE PRECISION,
    di_heatsink_trer                            DOUBLE PRECISION,
    di_inverter_tf                              DOUBLE PRECISION,
    di_inverter_tr                              DOUBLE PRECISION,
    di_inverter_trel                            DOUBLE PRECISION,
    di_inverter_trer                            DOUBLE PRECISION,
    di_motor_current_f                          DOUBLE PRECISION,
    di_motor_current_r                          DOUBLE PRECISION,
    di_motor_current_rel                        DOUBLE PRECISION,
    di_motor_current_rer                        DOUBLE PRECISION,
    di_slave_torque_cmd                         DOUBLE PRECISION,
    di_state_f                                  VARCHAR(50),
    di_state_r                                  VARCHAR(50),
    di_state_rel                                VARCHAR(50),
    di_state_rer                                VARCHAR(50),
    di_stator_temp_f                            DOUBLE PRECISION,
    di_stator_temp_r                            DOUBLE PRECISION,
    di_stator_temp_rel                          DOUBLE PRECISION,
    di_stator_temp_rer                          DOUBLE PRECISION,
    di_torque_actual_f                          DOUBLE PRECISION,
    di_torque_actual_r                          DOUBLE PRECISION,
    di_torque_actual_rel                        DOUBLE PRECISION,
    di_torque_actual_rer                        DOUBLE PRECISION,
    di_torquemotor                              DOUBLE PRECISION,
    di_v_bat_f                                  DOUBLE PRECISION,
    di_v_bat_r                                  DOUBLE PRECISION,
    di_v_bat_rel                                DOUBLE PRECISION,
    di_v_bat_rer                                DOUBLE PRECISION,
    drive_rail                                  BOOLEAN,
    hvil                                        VARCHAR(50),
    cruise_set_speed                            DOUBLE PRECISION,

    -- === 000028: Climate Extended ===
    hvac_fan_speed                              INTEGER,
    auto_seat_climate_left                      BOOLEAN,
    auto_seat_climate_right                     BOOLEAN,
    cabin_overheat_protection_mode              VARCHAR(60),
    cabin_overheat_protection_temperature_limit VARCHAR(60),
    climate_keeper_mode                         VARCHAR(50),
    climate_seat_cooling_front_left             INTEGER,
    climate_seat_cooling_front_right            INTEGER,
    defrost_for_preconditioning                 BOOLEAN,
    defrost_mode                                VARCHAR(50),
    hvac_ac_enabled                             BOOLEAN,
    hvac_auto_mode                              VARCHAR(50),
    hvac_fan_status                             INTEGER,
    hvac_left_temperature_request               DOUBLE PRECISION,
    hvac_right_temperature_request              DOUBLE PRECISION,
    hvac_steering_wheel_heat_auto               BOOLEAN,
    hvac_steering_wheel_heat_level              INTEGER,
    not_enough_power_to_heat                    BOOLEAN,
    preconditioning_enabled                     BOOLEAN,
    rear_defrost_enabled                        BOOLEAN,
    rear_display_hvac_enabled                   BOOLEAN,
    seat_heater_left                            INTEGER,
    seat_heater_right                           INTEGER,
    seat_heater_rear_left                       INTEGER,
    seat_heater_rear_center                     INTEGER,
    seat_heater_rear_right                      INTEGER,
    seat_vent_enabled                           BOOLEAN,
    wiper_heat_enabled                          BOOLEAN,

    -- === 000028: Safety / ADAS ===
    automatic_blind_spot_camera                 BOOLEAN,
    automatic_emergency_braking_off             BOOLEAN,
    blind_spot_collision_warning_chime          BOOLEAN,
    cruise_follow_distance                      INTEGER,
    driver_seat_belt                            BOOLEAN,
    emergency_lane_departure_avoidance          VARCHAR(50),
    forward_collision_warning                   VARCHAR(50),
    lane_departure_avoidance                    VARCHAR(50),
    passenger_seat_belt                         BOOLEAN,
    speed_limit_warning                         VARCHAR(50),

    -- === 000028: Media ===
    media_audio_volume                          DOUBLE PRECISION,
    media_audio_volume_increment                DOUBLE PRECISION,
    media_audio_volume_max                      DOUBLE PRECISION,
    media_now_playing_album                     VARCHAR(255),
    media_now_playing_artist                    VARCHAR(255),
    media_now_playing_duration                  DOUBLE PRECISION,
    media_now_playing_elapsed                   DOUBLE PRECISION,
    media_now_playing_station                   VARCHAR(255),
    media_now_playing_title                     VARCHAR(255),
    media_playback_source                       VARCHAR(50),
    media_playback_status                       VARCHAR(50),

    -- === 000028: Navigation ===
    destination_name                            VARCHAR(255),
    expected_energy_percent_at_trip_arrival      DOUBLE PRECISION,
    miles_since_reset                           DOUBLE PRECISION,
    miles_to_arrival                            DOUBLE PRECISION,
    minutes_to_arrival                          DOUBLE PRECISION,
    route_last_updated                          VARCHAR(100),
    route_line                                  TEXT,
    route_traffic_minutes_delay                 DOUBLE PRECISION,
    self_driving_miles_since_reset              DOUBLE PRECISION,

    -- === 000028: TPMS Extended ===
    tpms_hard_warnings                          INTEGER,
    tpms_last_seen_pressure_time_fl             TIMESTAMPTZ,
    tpms_last_seen_pressure_time_fr             TIMESTAMPTZ,
    tpms_last_seen_pressure_time_rl             TIMESTAMPTZ,
    tpms_last_seen_pressure_time_rr             TIMESTAMPTZ,
    tpms_soft_warnings                          INTEGER,

    -- === 000028: Battery / BMS ===
    bms_state                                   VARCHAR(50),
    battery_heater_on                           BOOLEAN,
    bms_fullchargecomplete                      BOOLEAN,
    brick_voltage_max                           DOUBLE PRECISION,
    brick_voltage_min                           DOUBLE PRECISION,
    isolation_resistance                        DOUBLE PRECISION,
    lifetime_energy_gained_regen                DOUBLE PRECISION,
    lifetime_energy_used                        DOUBLE PRECISION,
    lifetime_energy_used_drive                  DOUBLE PRECISION,
    module_temp_max                             DOUBLE PRECISION,
    module_temp_min                             DOUBLE PRECISION,
    num_brick_voltage_max                       INTEGER,
    num_brick_voltage_min                       INTEGER,
    num_module_temp_max                         INTEGER,
    num_module_temp_min                         INTEGER,
    pack_current                                DOUBLE PRECISION,
    pack_voltage                                DOUBLE PRECISION,

    -- === 000028: User Preferences ===
    setting24_hour_time                         BOOLEAN,
    setting_charge_unit                         VARCHAR(20),
    setting_distance_unit                       VARCHAR(20),
    setting_temperature_unit                    VARCHAR(20),
    setting_tire_pressure_unit                  VARCHAR(20),

    -- === 000028: Powershare ===
    powershare_hours_left                       DOUBLE PRECISION,
    powershare_instantaneous_power_kw           DOUBLE PRECISION,
    powershare_status                           VARCHAR(50),
    powershare_stop_reason                      VARCHAR(50),
    powershare_type                             VARCHAR(50),

    -- === 000028: Other ===
    lateral_acceleration                        DOUBLE PRECISION,
    located_at_favorite                         BOOLEAN,
    located_at_home                             BOOLEAN,
    located_at_work                             BOOLEAN,
    longitudinal_acceleration                   DOUBLE PRECISION,
    pin_to_drive_enabled                        BOOLEAN,
    tonneau_open_percent                        DOUBLE PRECISION,
    tonneau_position                            VARCHAR(50),
    tonneau_tent_mode                           BOOLEAN
);

-- ============================================================================
-- 10. charging_telemetry (000017 + 000026 widens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS charging_telemetry (
    id                                BIGSERIAL PRIMARY KEY,
    vehicle_id                        BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    battery_level                     DOUBLE PRECISION,
    soc                               DOUBLE PRECISION,
    charge_state                      VARCHAR(50),
    detailed_charge_state             VARCHAR(50),
    charge_limit_soc                  INTEGER,
    charge_amps                       DOUBLE PRECISION,
    charge_current_request            DOUBLE PRECISION,
    charge_current_request_max        DOUBLE PRECISION,
    charge_enable_request             BOOLEAN,
    charger_voltage                   DOUBLE PRECISION,
    charger_phases                    INTEGER,
    charge_rate_mph                   DOUBLE PRECISION,
    dc_charging_power                 DOUBLE PRECISION,
    dc_charging_energy_in             DOUBLE PRECISION,
    ac_charging_power                 DOUBLE PRECISION,
    ac_charging_energy_in             DOUBLE PRECISION,
    energy_remaining                  DOUBLE PRECISION,
    est_battery_range                 DOUBLE PRECISION,
    ideal_battery_range               DOUBLE PRECISION,
    rated_range                       DOUBLE PRECISION,
    pack_voltage                      DOUBLE PRECISION,
    pack_current                      DOUBLE PRECISION,
    charge_port_door_open             BOOLEAN,
    charge_port_latch                 VARCHAR(50),
    charge_port_cold_weather_mode     BOOLEAN,
    charging_cable_type               VARCHAR(50),
    fast_charger_present              BOOLEAN,
    fast_charger_type                 VARCHAR(50),
    time_to_full_charge               DOUBLE PRECISION,
    estimated_hours_to_charge         DOUBLE PRECISION,
    scheduled_charging_mode           VARCHAR(50),
    scheduled_charging_pending        BOOLEAN,
    preconditioning_enabled           BOOLEAN,
    brick_voltage_max                 DOUBLE PRECISION,
    brick_voltage_min                 DOUBLE PRECISION,
    num_brick_voltage_max             INTEGER,
    num_brick_voltage_min             INTEGER,
    module_temp_max                   DOUBLE PRECISION,
    module_temp_min                   DOUBLE PRECISION,
    num_module_temp_max               INTEGER,
    num_module_temp_min               INTEGER,
    battery_heater_on                 BOOLEAN,
    not_enough_power_to_heat          BOOLEAN,
    bms_state                         VARCHAR(50),
    bms_fullcharge_complete           BOOLEAN,
    dcdc_enable                       BOOLEAN,
    isolation_resistance              DOUBLE PRECISION,
    lifetime_energy_used              DOUBLE PRECISION,
    supercharger_session_trip_planner BOOLEAN,
    powershare_status                 VARCHAR(50),
    powershare_type                   VARCHAR(50),
    powershare_stop_reason            VARCHAR(30),
    powershare_hours_left             INTEGER,
    powershare_power_kw               DOUBLE PRECISION,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_charging_telemetry_vehicle_time
    ON charging_telemetry (vehicle_id, created_at DESC);

-- ============================================================================
-- 11. charge_telemetry_readings (000021)
-- ============================================================================
CREATE TABLE IF NOT EXISTS charge_telemetry_readings (
    id            BIGSERIAL PRIMARY KEY,
    session_id    BIGINT NOT NULL REFERENCES charging_sessions(id) ON DELETE CASCADE,
    vehicle_id    BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    battery_level INTEGER,
    soc           DOUBLE PRECISION,
    power_kw      DOUBLE PRECISION,
    voltage       DOUBLE PRECISION,
    current_amps  DOUBLE PRECISION,
    phases        INTEGER,
    energy_added  DOUBLE PRECISION,
    rated_range   DOUBLE PRECISION,
    ideal_range   DOUBLE PRECISION,
    est_range     DOUBLE PRECISION,
    inside_temp   DOUBLE PRECISION,
    outside_temp  DOUBLE PRECISION,
    battery_temp  DOUBLE PRECISION,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    charge_rate   DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_charge_telemetry_session_id
    ON charge_telemetry_readings (session_id);
CREATE INDEX IF NOT EXISTS idx_charge_telemetry_vehicle_time
    ON charge_telemetry_readings (vehicle_id, created_at DESC);

-- ============================================================================
-- 12. drive_telemetry_readings (000021)
-- ============================================================================
CREATE TABLE IF NOT EXISTS drive_telemetry_readings (
    id               BIGSERIAL PRIMARY KEY,
    drive_id         BIGINT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    vehicle_id       BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude         DOUBLE PRECISION,
    longitude        DOUBLE PRECISION,
    elevation        DOUBLE PRECISION,
    heading          INTEGER,
    odometer         DOUBLE PRECISION,
    speed            DOUBLE PRECISION,
    power            DOUBLE PRECISION,
    battery_level    INTEGER,
    soc              DOUBLE PRECISION,
    usable_soc       DOUBLE PRECISION,
    rated_range      DOUBLE PRECISION,
    ideal_range      DOUBLE PRECISION,
    est_range        DOUBLE PRECISION,
    inside_temp      DOUBLE PRECISION,
    outside_temp     DOUBLE PRECISION,
    driver_temp      DOUBLE PRECISION,
    passenger_temp   DOUBLE PRECISION,
    fan_status       INTEGER,
    is_climate_on    BOOLEAN,
    tire_pressure_fl DOUBLE PRECISION,
    tire_pressure_fr DOUBLE PRECISION,
    tire_pressure_rl DOUBLE PRECISION,
    tire_pressure_rr DOUBLE PRECISION,
    battery_heater_on BOOLEAN,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_telemetry_drive_id
    ON drive_telemetry_readings (drive_id);
CREATE INDEX IF NOT EXISTS idx_drive_telemetry_vehicle_time
    ON drive_telemetry_readings (vehicle_id, created_at DESC);
