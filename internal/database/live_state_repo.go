package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// LiveStateRepo manages the vehicle_live_state table ╬ô├ç├╢ one row per vehicle
// with always-complete signal state, updated via UPSERT.
type LiveStateRepo struct {
	db *DB
}

// varchar columns in vehicle_live_state ╬ô├ç├╢ values must be written as strings
var isVarcharCol = map[string]bool{
	"gear": true, "charge_state": true, "detailed_charge_state": true, "charging_cable_type": true,
	"door_state": true, "fd_window": true, "fp_window": true, "rd_window": true, "rp_window": true,
	"center_display": true, "vehicle_name": true, "car_type": true, "version": true, "wheel_type": true,
	"exterior_color": true, "guest_mode_mobile_access": true, "lights_turn_signal": true,
	"sw_update_version": true, "sw_update_scheduled_start": true,
	"trim": true, "roof_color": true, "efficiency_package": true, "rear_seat_heaters": true, "sunroof_installed": true,
	"last_gear": true, "bms_state": true, "cabin_overheat_protection_mode": true,
	"cabin_overheat_protection_temperature_limit": true, "charge_port": true, "charge_port_latch": true,
	"climate_keeper_mode": true, "cruise_follow_distance": true, "destination_name": true,
	"di_state_f": true, "di_state_r": true, "di_state_rel": true, "di_state_rer": true,
	"fast_charger_type": true, "forward_collision_warning": true, "hvac_auto_mode": true, "hvil": true,
	"lane_departure_avoidance": true, "media_now_playing_album": true, "media_now_playing_artist": true,
	"media_now_playing_station": true, "media_now_playing_title": true, "media_playback_source": true,
	"media_playback_status": true, "powershare_status": true, "powershare_stop_reason": true, "powershare_type": true,
	"route_last_updated": true, "route_line": true, "scheduled_charging_mode": true,
	"scheduled_charging_start_time": true, "scheduled_departure_time": true,
	"setting24_hour_time": true, "setting_charge_unit": true, "setting_distance_unit": true,
	"setting_temperature_unit": true, "setting_tire_pressure_unit": true,
	"speed_limit_warning": true, "supercharger_session_trip_planner": true,
	"tonneau_position": true, "tonneau_tent_mode": true, "tpms_hard_warnings": true, "tpms_soft_warnings": true,
	"defrost_mode": true,
}

// timestamptz columns in vehicle_live_state
var isTimestampCol = map[string]bool{
	"tpms_last_seen_pressure_time_fl": true, "tpms_last_seen_pressure_time_fr": true,
	"tpms_last_seen_pressure_time_rl": true, "tpms_last_seen_pressure_time_rr": true,
	"last_speed_time": true,
}

// NewLiveStateRepo creates a new LiveStateRepo.
func NewLiveStateRepo(db *DB) *LiveStateRepo {
	return &LiveStateRepo{db: db}
}

// signalToColumn maps Tesla signal names to vehicle_live_state column names.
var signalToColumn = map[string]string{
	// Location
	"Latitude":  "latitude",
	"Longitude": "longitude",
	"GpsHeading": "heading",
	"GpsState":  "gps_state",

	// Driving
	"VehicleSpeed":   "speed",
	"Odometer":       "odometer",
	"Gear":           "gear",
	"PedalPosition":  "pedal_position",
	"BrakePedal":     "brake_pedal",

	// Battery / Range
	"BatteryLevel":    "battery_level",
	"Soc":             "soc",
	"IdealBatteryRange": "ideal_range",
	"RatedRange":      "rated_range",
	"EstBatteryRange": "est_range",
	"EnergyRemaining": "energy_remaining",

	// Climate
	"InsideTemp":  "inside_temp",
	"OutsideTemp": "outside_temp",

	// Charging
	"ChargeState":         "charge_state",
	"DetailedChargeState": "detailed_charge_state",
	"ChargerVoltage":      "charger_voltage",
	"ChargeAmps":          "charge_amps",
	"ChargeRateMilePerHour": "charge_rate",
	"DCChargingPower":     "charger_power",
	// ACChargingPower also maps to charger_power but is handled in the skip/special logic
	// to avoid duplicate column errors when both signals arrive in the same batch.
	"ChargeLimitSoc":      "charge_limit_soc",
	"TimeToFullCharge":    "time_to_full_charge",
	"ChargingCableType":   "charging_cable_type",

	// Security
	"Locked":       "locked",
	"SentryMode":   "sentry_mode",
	"DoorState":    "door_state",
	"FdWindow":     "fd_window",
	"FpWindow":     "fp_window",
	"RdWindow":     "rd_window",
	"RpWindow":     "rp_window",
	"CenterDisplay": "center_display",

	// Vehicle State (access modes, lights, driver)
	"GuestModeEnabled":          "guest_mode",
	"GuestModeMobileAccessState": "guest_mode_mobile_access",
	"HomelinkNearby":            "homelink_nearby",
	"HomelinkDeviceCount":       "homelink_device_count",
	"DriverSeatOccupied":        "driver_seat_occupied",
	"SpeedLimitMode":            "speed_limit_mode",
	"ValetModeEnabled":          "valet_mode_enabled",
	"ServiceMode":               "service_mode",
	"CurrentLimitMph":           "current_limit_mph",
	"PairedPhoneKeyAndKeyFobQty": "paired_phone_key_count",
	"LightsHazardsActive":       "lights_hazards_active",
	"LightsHighBeams":           "lights_high_beams",
	"LightsTurnSignal":          "lights_turn_signal",

	// Software Update
	"SoftwareUpdateVersion":                    "sw_update_version",
	"SoftwareUpdateDownloadPercentComplete":     "sw_update_download_pct",
	"SoftwareUpdateInstallationPercentComplete": "sw_update_install_pct",
	"SoftwareUpdateExpectedDurationMinutes":     "sw_update_expected_duration",
	"SoftwareUpdateScheduledStartTime":          "sw_update_scheduled_start",

	// Tire Pressure
	"TpmsPressureFl": "tire_pressure_fl",
	"TpmsPressureFr": "tire_pressure_fr",
	"TpmsPressureRl": "tire_pressure_rl",
	"TpmsPressureRr": "tire_pressure_rr",
	"TpmsFl":         "tire_pressure_fl",
	"TpmsFr":         "tire_pressure_fr",
	"TpmsRl":         "tire_pressure_rl",
	"TpmsRr":         "tire_pressure_rr",

	// Vehicle Info
	"VehicleName":   "vehicle_name",
	"CarType":       "car_type",
	"Version":       "version",
	"WheelType":     "wheel_type",
	"ExteriorColor": "exterior_color",

	// State Machine (persisted for pod restart recovery)
	"_LastGear":      "last_gear",
	"_LastSpeedTime": "last_speed_time",

	// Vehicle Configuration
	"Trim":                    "trim",
	"RoofColor":               "roof_color",
	"EfficiencyPackage":       "efficiency_package",
	"RearSeatHeaters":         "rear_seat_heaters",
	"SunroofInstalled":        "sunroof_installed",
	"EuropeVehicle":           "europe_vehicle",
	"RightHandDrive":          "right_hand_drive",
	"RemoteStartEnabled":      "remote_start_enabled",
	"OffroadLightbarPresent":  "offroad_lightbar_present",

	// === Complete Signal Coverage (all remaining Fleet Telemetry signals) ===

	// Charging telemetry
	"ACChargingEnergyIn":               "ac_charging_energy_in",
	"ChargeCurrentRequest":             "charge_current_request",
	"ChargeCurrentRequestMax":          "charge_current_request_max",
	"ChargeEnableRequest":              "charge_enable_request",
	"ChargePort":                       "charge_port",
	"ChargePortColdWeatherMode":        "charge_port_cold_weather_mode",
	"ChargePortDoorOpen":               "charge_port_door_open",
	"ChargePortLatch":                  "charge_port_latch",
	"ChargerPhases":                    "charger_phases",
	"DCChargingEnergyIn":               "dc_charging_energy_in",
	"EstimatedHoursToChargeTermination": "estimated_hours_to_charge_termination",
	"FastChargerPresent":               "fast_charger_present",
	"FastChargerType":                  "fast_charger_type",
	"ScheduledChargingMode":            "scheduled_charging_mode",
	"ScheduledChargingPending":         "scheduled_charging_pending",
	"ScheduledChargingStartTime":       "scheduled_charging_start_time",
	"ScheduledDepartureTime":           "scheduled_departure_time",
	"SuperchargerSessionTripPlanner":   "supercharger_session_trip_planner",

	// Motor/Powertrain
	"BrakePedalPos":     "brake_pedal_pos",
	"DCDCEnable":        "dcdc_enable",
	"DiAxleSpeedF":      "di_axle_speed_f",
	"DiAxleSpeedR":      "di_axle_speed_r",
	"DiAxleSpeedREL":    "di_axle_speed_rel",
	"DiAxleSpeedRER":    "di_axle_speed_rer",
	"DiHeatsinkTF":      "di_heatsink_tf",
	"DiHeatsinkTR":      "di_heatsink_tr",
	"DiHeatsinkTREL":    "di_heatsink_trel",
	"DiHeatsinkTRER":    "di_heatsink_trer",
	"DiInverterTF":      "di_inverter_tf",
	"DiInverterTR":      "di_inverter_tr",
	"DiInverterTREL":    "di_inverter_trel",
	"DiInverterTRER":    "di_inverter_trer",
	"DiMotorCurrentF":   "di_motor_current_f",
	"DiMotorCurrentR":   "di_motor_current_r",
	"DiMotorCurrentREL": "di_motor_current_rel",
	"DiMotorCurrentRER": "di_motor_current_rer",
	"DiSlaveTorqueCmd":  "di_slave_torque_cmd",
	"DiStateF":          "di_state_f",
	"DiStateR":          "di_state_r",
	"DiStateREL":        "di_state_rel",
	"DiStateRER":        "di_state_rer",
	"DiStatorTempF":     "di_stator_temp_f",
	"DiStatorTempR":     "di_stator_temp_r",
	"DiStatorTempREL":   "di_stator_temp_rel",
	"DiStatorTempRER":   "di_stator_temp_rer",
	"DiTorqueActualF":   "di_torque_actual_f",
	"DiTorqueActualR":   "di_torque_actual_r",
	"DiTorqueActualREL": "di_torque_actual_rel",
	"DiTorqueActualRER": "di_torque_actual_rer",
	"DiTorquemotor":     "di_torquemotor",
	"DiVBatF":           "di_v_bat_f",
	"DiVBatR":           "di_v_bat_r",
	"DiVBatREL":         "di_v_bat_rel",
	"DiVBatRER":         "di_v_bat_rer",
	"DriveRail":         "drive_rail",

	// Climate
	"AutoSeatClimateLeft":                    "auto_seat_climate_left",
	"AutoSeatClimateRight":                   "auto_seat_climate_right",
	"CabinOverheatProtectionMode":            "cabin_overheat_protection_mode",
	"CabinOverheatProtectionTemperatureLimit": "cabin_overheat_protection_temperature_limit",
	"ClimateKeeperMode":                      "climate_keeper_mode",
	"ClimateSeatCoolingFrontLeft":             "climate_seat_cooling_front_left",
	"ClimateSeatCoolingFrontRight":            "climate_seat_cooling_front_right",
	"DefrostForPreconditioning":              "defrost_for_preconditioning",
	"DefrostMode":                            "defrost_mode",
	"HvacACEnabled":                          "hvac_ac_enabled",
	"HvacAutoMode":                           "hvac_auto_mode",
	"HvacFanSpeed":                           "hvac_fan_speed",
	"HvacFanStatus":                          "hvac_fan_status",
	"HvacLeftTemperatureRequest":             "hvac_left_temperature_request",
	"HvacPower":                              "hvac_power",
	"HvacRightTemperatureRequest":            "hvac_right_temperature_request",
	"HvacSteeringWheelHeatAuto":              "hvac_steering_wheel_heat_auto",
	"HvacSteeringWheelHeatLevel":             "hvac_steering_wheel_heat_level",
	"Hvil":                                   "hvil",
	"NotEnoughPowerToHeat":                   "not_enough_power_to_heat",
	"PreconditioningEnabled":                 "preconditioning_enabled",
	"RearDefrostEnabled":                     "rear_defrost_enabled",
	"RearDisplayHvacEnabled":                 "rear_display_hvac_enabled",
	"SeatHeaterLeft":                         "seat_heater_left",
	"SeatHeaterRearCenter":                   "seat_heater_rear_center",
	"SeatHeaterRearLeft":                     "seat_heater_rear_left",
	"SeatHeaterRearRight":                    "seat_heater_rear_right",
	"SeatHeaterRight":                        "seat_heater_right",
	"SeatVentEnabled":                        "seat_vent_enabled",
	"WiperHeatEnabled":                       "wiper_heat_enabled",

	// Safety/ADAS
	"AutomaticBlindSpotCamera":         "automatic_blind_spot_camera",
	"AutomaticEmergencyBrakingOff":     "automatic_emergency_braking_off",
	"BlindSpotCollisionWarningChime":   "blind_spot_collision_warning_chime",
	"CruiseFollowDistance":             "cruise_follow_distance",
	"CruiseSetSpeed":                   "cruise_set_speed",
	"DriverSeatBelt":                   "driver_seat_belt",
	"EmergencyLaneDepartureAvoidance":  "emergency_lane_departure_avoidance",
	"ForwardCollisionWarning":          "forward_collision_warning",
	"LaneDepartureAvoidance":           "lane_departure_avoidance",
	"PassengerSeatBelt":                "passenger_seat_belt",
	"SpeedLimitWarning":                "speed_limit_warning",

	// Media
	"MediaAudioVolume":          "media_audio_volume",
	"MediaAudioVolumeIncrement": "media_audio_volume_increment",
	"MediaAudioVolumeMax":       "media_audio_volume_max",
	"MediaNowPlayingAlbum":      "media_now_playing_album",
	"MediaNowPlayingArtist":     "media_now_playing_artist",
	"MediaNowPlayingDuration":   "media_now_playing_duration",
	"MediaNowPlayingElapsed":    "media_now_playing_elapsed",
	"MediaNowPlayingStation":    "media_now_playing_station",
	"MediaNowPlayingTitle":      "media_now_playing_title",
	"MediaPlaybackSource":       "media_playback_source",
	"MediaPlaybackStatus":       "media_playback_status",

	// Navigation
	"DestinationName":                   "destination_name",
	"ExpectedEnergyPercentAtTripArrival": "expected_energy_percent_at_trip_arrival",
	"MilesSinceReset":                   "miles_since_reset",
	"MilesToArrival":                    "miles_to_arrival",
	"MinutesToArrival":                  "minutes_to_arrival",
	"RouteLastUpdated":                  "route_last_updated",
	"RouteLine":                         "route_line",
	"RouteTrafficMinutesDelay":          "route_traffic_minutes_delay",
	"SelfDrivingMilesSinceReset":        "self_driving_miles_since_reset",

	// TPMS
	"TpmsHardWarnings":            "tpms_hard_warnings",
	"TpmsLastSeenPressureTimeFl":  "tpms_last_seen_pressure_time_fl",
	"TpmsLastSeenPressureTimeFr":  "tpms_last_seen_pressure_time_fr",
	"TpmsLastSeenPressureTimeRl":  "tpms_last_seen_pressure_time_rl",
	"TpmsLastSeenPressureTimeRr":  "tpms_last_seen_pressure_time_rr",
	"TpmsSoftWarnings":            "tpms_soft_warnings",

	// Battery/BMS
	"BMSState":                  "bms_state",
	"BatteryHeaterOn":           "battery_heater_on",
	"BmsFullchargecomplete":     "bms_fullchargecomplete",
	"BrickVoltageMax":           "brick_voltage_max",
	"BrickVoltageMin":           "brick_voltage_min",
	"IsolationResistance":       "isolation_resistance",
	"LifetimeEnergyGainedRegen": "lifetime_energy_gained_regen",
	"LifetimeEnergyUsed":        "lifetime_energy_used",
	"LifetimeEnergyUsedDrive":   "lifetime_energy_used_drive",
	"ModuleTempMax":             "module_temp_max",
	"ModuleTempMin":             "module_temp_min",
	"NumBrickVoltageMax":        "num_brick_voltage_max",
	"NumBrickVoltageMin":        "num_brick_voltage_min",
	"NumModuleTempMax":          "num_module_temp_max",
	"NumModuleTempMin":          "num_module_temp_min",
	"PackCurrent":               "pack_current",
	"PackVoltage":               "pack_voltage",

	// User Preferences
	"Setting24HourTime":       "setting24_hour_time",
	"SettingChargeUnit":       "setting_charge_unit",
	"SettingDistanceUnit":     "setting_distance_unit",
	"SettingTemperatureUnit":  "setting_temperature_unit",
	"SettingTirePressureUnit": "setting_tire_pressure_unit",

	// Powershare
	"PowershareHoursLeft":            "powershare_hours_left",
	"PowershareInstantaneousPowerKW": "powershare_instantaneous_power_kw",
	"PowershareStatus":               "powershare_status",
	"PowershareStopReason":           "powershare_stop_reason",
	"PowershareType":                 "powershare_type",

	// Other
	"LateralAcceleration":      "lateral_acceleration",
	"LocatedAtFavorite":        "located_at_favorite",
	"LocatedAtHome":            "located_at_home",
	"LocatedAtWork":            "located_at_work",
	"LongitudinalAcceleration": "longitudinal_acceleration",
	"PinToDriveEnabled":        "pin_to_drive_enabled",
	"TonneauOpenPercent":       "tonneau_open_percent",
	"TonneauPosition":          "tonneau_position",
	"TonneauTentMode":          "tonneau_tent_mode",
}

// normalizeSignalValue unwraps wrapped signal values and converts types.
// Fleet Telemetry occasionally wraps values in {"value": X, "timestamp": "..."}
// objects (Bug 4), or sends {"invalid": true} markers.
// Returns the unwrapped value and whether it should be used.
func normalizeSignalValue(v interface{}) (interface{}, bool) {
	if v == nil {
		return nil, false
	}
	m, isMap := v.(map[string]interface{})
	if !isMap {
		return v, true
	}
	// Skip explicit invalid markers
	if inv, has := m["invalid"]; has {
		if b, isBool := inv.(bool); isBool && b {
			return nil, false
		}
	}
	// Unwrap {"value": X, ...} envelopes
	if inner, ok := m["value"]; ok {
		return inner, true
	}
	return nil, false
}

// FlushLiveState upserts the vehicle's live state into vehicle_live_state.
// Only columns with non-nil values in the signals map are updated.
func (r *LiveStateRepo) FlushLiveState(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	// Collect column names and values; parameter indices are computed at the
	// end so INSERT and ON CONFLICT UPDATE use identical numbering.
	cols := []string{}
	vals := []interface{}{}

	// Handle Location (JSON object with latitude/longitude)
	if loc, ok := signals["Location"].(map[string]interface{}); ok {
		if lat, ok := loc["latitude"]; ok {
			cols = append(cols, "latitude")
			vals = append(vals, lat)
		}
		if lon, ok := loc["longitude"]; ok {
			cols = append(cols, "longitude")
			vals = append(vals, lon)
		}
	}

	// Handle computed power
	if _, hasPV := signals["PackVoltage"]; hasPV {
		if _, hasPC := signals["PackCurrent"]; hasPC {
			pv, pvOk := toFloat64(signals["PackVoltage"])
			pc, pcOk := toFloat64(signals["PackCurrent"])
			if pvOk && pcOk {
				power := pv * pc / 1000.0
				cols = append(cols, "power")
				vals = append(vals, power)
			}
		}
	}

	// Handle HvacPower (enum ╬ô├Ñ├å boolean)
	if raw, ok := signals["HvacPower"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "hvac_power")
			vals = append(vals, enums.ParseHvacPower(fmt.Sprintf("%v", v)))
		}
	}

	// Handle HvacFanSpeed ╬ô├Ñ├å fan_speed (special column name differs from signalToColumn)
	if raw, ok := signals["HvacFanSpeed"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "fan_speed")
			vals = append(vals, v)
		}
	}

	// Handle SentryMode (enum ╬ô├Ñ├å boolean)
	if raw, ok := signals["SentryMode"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "sentry_mode")
			vals = append(vals, enums.ParseEnumBool(v))
		}
	}

	// Handle Locked (may be bool or string)
	if raw, ok := signals["Locked"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "locked")
			vals = append(vals, enums.ParseEnumBool(v))
		}
	}

	// Handle ACChargingPower ╬ô├Ñ├å charger_power (fallback if DCChargingPower not present)
	// Both map to same column, so only write one to avoid "column specified more than once"
	if _, hasDC := signals["DCChargingPower"]; !hasDC {
		if v, ok := signals["ACChargingPower"]; ok {
			if f, fOk := toFloat64(v); fOk {
				cols = append(cols, "charger_power")
				vals = append(vals, f)
			}
		}
	}

	// Handle DriverSeatBelt (enum → boolean: "BuckleStatusLatched" → true)
	if raw, ok := signals["DriverSeatBelt"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "driver_seat_belt")
			vals = append(vals, enums.ParseBuckleStatus(v))
		}
	}

	// Handle PassengerSeatBelt (enum → boolean: "BuckleStatusLatched" → true)
	if raw, ok := signals["PassengerSeatBelt"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "passenger_seat_belt")
			vals = append(vals, enums.ParseBuckleStatus(v))
		}
	}

	// Boolean columns that come as enum strings from Fleet Telemetry.
	// These need conversion: any non-Off/empty/false string ╬ô├Ñ├å true.
	enumBoolSignals := map[string]string{
		"GuestModeEnabled":        "guest_mode",
		"HomelinkNearby":          "homelink_nearby",
		"DriverSeatOccupied":      "driver_seat_occupied",
		"SpeedLimitMode":          "speed_limit_mode",
		"ValetModeEnabled":        "valet_mode_enabled",
		"ServiceMode":             "service_mode",
		"LightsHazardsActive":     "lights_hazards_active",
		"LightsHighBeams":         "lights_high_beams",
		"EuropeVehicle":           "europe_vehicle",
		"RightHandDrive":          "right_hand_drive",
		"RemoteStartEnabled":      "remote_start_enabled",
		"OffroadLightbarPresent":              "offroad_lightbar_present",
		"AutoSeatClimateLeft":                 "auto_seat_climate_left",
		"AutoSeatClimateRight":                "auto_seat_climate_right",
		"AutomaticBlindSpotCamera":            "automatic_blind_spot_camera",
		"AutomaticEmergencyBrakingOff":        "automatic_emergency_braking_off",
		"BatteryHeaterOn":                     "battery_heater_on",
		"BlindSpotCollisionWarningChime":      "blind_spot_collision_warning_chime",
		"BmsFullchargecomplete":               "bms_fullchargecomplete",
		"ChargeEnableRequest":                 "charge_enable_request",
		"ChargePortColdWeatherMode":           "charge_port_cold_weather_mode",
		"ChargePortDoorOpen":                  "charge_port_door_open",
		"DCDCEnable":                          "dcdc_enable",
		"DefrostForPreconditioning":           "defrost_for_preconditioning",
		"DefrostMode":                         "defrost_mode",
		"DriveRail":                           "drive_rail",

		"EmergencyLaneDepartureAvoidance":     "emergency_lane_departure_avoidance",
		"FastChargerPresent":                  "fast_charger_present",
		"HvacACEnabled":                       "hvac_ac_enabled",
		"HvacSteeringWheelHeatAuto":           "hvac_steering_wheel_heat_auto",
		"LocatedAtFavorite":                   "located_at_favorite",
		"LocatedAtHome":                       "located_at_home",
		"LocatedAtWork":                       "located_at_work",
		"NotEnoughPowerToHeat":                "not_enough_power_to_heat",

		"PinToDriveEnabled":                   "pin_to_drive_enabled",
		"PreconditioningEnabled":              "preconditioning_enabled",
		"RearDefrostEnabled":                  "rear_defrost_enabled",
		"RearDisplayHvacEnabled":              "rear_display_hvac_enabled",
		"ScheduledChargingPending":            "scheduled_charging_pending",
		"SeatVentEnabled":                     "seat_vent_enabled",
		"WiperHeatEnabled":                    "wiper_heat_enabled",
	}
	for sig, col := range enumBoolSignals {
		if raw, ok := signals[sig]; ok && raw != nil {
			v, use := normalizeSignalValue(raw)
			if !use {
				continue
			}
			cols = append(cols, col)
			vals = append(vals, enums.ParseEnumBool(v))
		}
	}

	// Set of columns already handled above ╬ô├ç├╢ skip in generic loop.
	// hvac_fan_speed is here because HvacFanSpeed is handled specially above (╬ô├Ñ├å fan_speed).
	skipCols := map[string]bool{
		"latitude": true, "longitude": true, "locked": true, "sentry_mode": true,
		"hvac_power": true, "fan_speed": true, "hvac_fan_speed": true,
		"power": true, "charger_power": true,
		"driver_seat_belt": true, "passenger_seat_belt": true,
	}
	for _, col := range enumBoolSignals {
		skipCols[col] = true
	}

	// Map all simple signals
	for signalName, colName := range signalToColumn {
		if skipCols[colName] {
			continue
		}
		raw, ok := signals[signalName]
		if !ok || raw == nil {
			continue
		}

		// Normalize: unwrap map envelopes, skip invalid markers (Bug 4)
		v, use := normalizeSignalValue(raw)
		if !use || v == nil {
			continue
		}

		// Convert TPMS timestamp floats to time.Time (Bug 3)
		if isTimestampCol[colName] {
			switch tv := v.(type) {
			case float64:
				if tv > 1e9 {
					sec := int64(tv)
					nsec := int64((tv - float64(sec)) * 1e9)
					v = time.Unix(sec, nsec).UTC()
				} else {
					continue // not a valid epoch
				}
			case string:
				// Try parsing as RFC3339 or unix timestamp string
				if t, err := time.Parse(time.RFC3339, tv); err == nil {
					v = t
				} else {
					continue
				}
			case time.Time:
				// Already correct type
			default:
				continue
			}
		}

		// Coerce value to match the Postgres column type.
		// Tesla sends booleans for some varchar columns (e.g., Setting24HourTime)
		// and floats for some timestamptz columns (e.g., TpmsLastSeenPressureTime*).
		switch v.(type) {
		case float64, int, int64, bool, string, time.Time:
			// OK ╬ô├ç├╢ these are base types pgx can handle
		default:
			continue
		}

		// For varchar columns, ensure we write a string (not bool/float).
		// pgx cannot encode bool→varchar or float→varchar directly.
		if isVarcharCol[colName] {
			vals = append(vals, fmt.Sprintf("%v", v))
		} else if isTimestampCol[colName] {
			// Already converted to time.Time above — just append
			vals = append(vals, v)
		} else {
			vals = append(vals, v)
		}
		cols = append(cols, colName)
	}

	if len(cols) == 0 {
		return nil // nothing to update
	}

	// Always update updated_at
	cols = append(cols, "updated_at")
	vals = append(vals, time.Now().UTC())

	// Build parameter placeholders and update clauses using the same indices.
	// $1 is vehicle_id; column values start at $2.
	colList := strings.Join(cols, ", ")
	placeholders := make([]string, len(cols))
	updates := make([]string, len(cols))
	for i, col := range cols {
		idx := i + 2 // $1 is vehicle_id
		placeholders[i] = fmt.Sprintf("$%d", idx)
		updates[i] = fmt.Sprintf("%s = $%d", col, idx)
	}

	query := fmt.Sprintf(
		`INSERT INTO vehicle_live_state (vehicle_id, %s) VALUES ($1, %s)
		 ON CONFLICT (vehicle_id) DO UPDATE SET %s`,
		colList,
		strings.Join(placeholders, ", "),
		strings.Join(updates, ", "),
	)

	allVals := make([]interface{}, 0, 1+len(vals))
	allVals = append(allVals, vehicleID)
	allVals = append(allVals, vals...)

	_, err := r.db.Pool.Exec(ctx, query, allVals...)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Int("cols", len(cols)).Msg("live_state: flush failed")
	}
	return err
}

// LoadLiveState reads the vehicle_live_state row into a signal map.
// Used to recover in-memory state after a pod restart.
func (r *LiveStateRepo) LoadLiveState(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	row := r.db.Pool.QueryRow(ctx, `
		SELECT latitude, longitude, heading, speed, power, odometer, gear,
		       battery_level, soc, ideal_range, rated_range, est_range, energy_remaining,
		       inside_temp, outside_temp, hvac_power, fan_speed,
		       charge_state, detailed_charge_state, charger_voltage, charge_amps,
		       charge_rate, charger_power, charge_limit_soc, time_to_full_charge,
		       locked, sentry_mode, door_state, center_display,
		       fd_window, fp_window, rd_window, rp_window,
		       tire_pressure_fl, tire_pressure_fr, tire_pressure_rl, tire_pressure_rr,
		       vehicle_name, car_type, version,
		       guest_mode, guest_mode_mobile_access, homelink_nearby, homelink_device_count,
		       driver_seat_occupied, speed_limit_mode, valet_mode_enabled, service_mode,
		       current_limit_mph, paired_phone_key_count,
		       lights_hazards_active, lights_high_beams, lights_turn_signal,
		       driver_seat_belt, passenger_seat_belt,
		       sw_update_version, sw_update_download_pct, sw_update_install_pct,
		       sw_update_expected_duration, sw_update_scheduled_start,
		       trim, roof_color, efficiency_package, rear_seat_heaters, sunroof_installed,
		       europe_vehicle, right_hand_drive, remote_start_enabled, offroad_lightbar_present,
		       last_gear, last_speed_time
		FROM vehicle_live_state WHERE vehicle_id = $1`, vehicleID)

	var lat, lon, speed, power, odo, idealR, ratedR, estR, energyRem *float64
	var insideT, outsideT, chargerV, chargeAmps, chargeRate, chargerPower, ttfc *float64
	var tpFL, tpFR, tpRL, tpRR *float64
	var currentLimitMph *float64
	var heading, battLvl, fanSpeed, chargeLimitSoc *int
	var homelinkDevCount, pairedKeyCount *int
	var swDownloadPct, swInstallPct, swExpectedDur *int
	var soc *float64
	var gear, chargeState, detailedCS, doorState, centerDisp *string
	var fdWindow, fpWindow, rdWindow, rpWindow *string
	var vehicleName, carType, version *string
	var guestMobileAccess, lightsTurnSignal *string
	var swUpdateVersion, swScheduledStart *string
	var trimVal, roofColor, efficiencyPkg, rearSeatHeaters, sunroofInstalled *string
	var hvacPower, locked, sentryMode *bool
	var guestMode, homelinkNearby, driverSeatOccupied *bool
	var speedLimitMode, valetMode, serviceMode *bool
	var lightsHazards, lightsHighBeams *bool
	var driverSeatBelt, passengerSeatBelt *bool
	var europeVehicle, rightHandDrive, remoteStartEnabled, offroadLightbar *bool
	var lastGearDB *string
	var lastSpeedTimeDB *time.Time

	err := row.Scan(
		&lat, &lon, &heading, &speed, &power, &odo, &gear,
		&battLvl, &soc, &idealR, &ratedR, &estR, &energyRem,
		&insideT, &outsideT, &hvacPower, &fanSpeed,
		&chargeState, &detailedCS, &chargerV, &chargeAmps,
		&chargeRate, &chargerPower, &chargeLimitSoc, &ttfc,
		&locked, &sentryMode, &doorState, &centerDisp,
		&fdWindow, &fpWindow, &rdWindow, &rpWindow,
		&tpFL, &tpFR, &tpRL, &tpRR,
		&vehicleName, &carType, &version,
		&guestMode, &guestMobileAccess, &homelinkNearby, &homelinkDevCount,
		&driverSeatOccupied, &speedLimitMode, &valetMode, &serviceMode,
		&currentLimitMph, &pairedKeyCount,
		&lightsHazards, &lightsHighBeams, &lightsTurnSignal,
		&driverSeatBelt, &passengerSeatBelt,
		&swUpdateVersion, &swDownloadPct, &swInstallPct,
		&swExpectedDur, &swScheduledStart,
		&trimVal, &roofColor, &efficiencyPkg, &rearSeatHeaters, &sunroofInstalled,
		&europeVehicle, &rightHandDrive, &remoteStartEnabled, &offroadLightbar,
		&lastGearDB, &lastSpeedTimeDB,
	)
	if err != nil {
		return nil, err
	}

	result := make(map[string]interface{})
	if lat != nil { result["Latitude"] = *lat }
	if lon != nil { result["Longitude"] = *lon }
	if heading != nil { result["GpsHeading"] = *heading }
	if speed != nil { result["VehicleSpeed"] = *speed }
	if power != nil { result["Power"] = *power }
	if odo != nil { result["Odometer"] = *odo }
	if gear != nil { result["Gear"] = *gear }
	if battLvl != nil { result["BatteryLevel"] = *battLvl }
	if soc != nil { result["Soc"] = *soc }
	if idealR != nil { result["IdealBatteryRange"] = *idealR }
	if ratedR != nil { result["RatedRange"] = *ratedR }
	if estR != nil { result["EstBatteryRange"] = *estR }
	if energyRem != nil { result["EnergyRemaining"] = *energyRem }
	if insideT != nil { result["InsideTemp"] = *insideT }
	if outsideT != nil { result["OutsideTemp"] = *outsideT }
	if hvacPower != nil { result["HvacPower"] = *hvacPower }
	if fanSpeed != nil { result["HvacFanSpeed"] = *fanSpeed }
	if chargeState != nil { result["ChargeState"] = *chargeState }
	if detailedCS != nil { result["DetailedChargeState"] = *detailedCS }
	if chargerV != nil { result["ChargerVoltage"] = *chargerV }
	if chargeAmps != nil { result["ChargeAmps"] = *chargeAmps }
	if chargeRate != nil { result["ChargeRateMilePerHour"] = *chargeRate }
	if chargerPower != nil { result["ChargingPower"] = *chargerPower }
	if chargeLimitSoc != nil { result["ChargeLimitSoc"] = *chargeLimitSoc }
	if ttfc != nil { result["TimeToFullCharge"] = *ttfc }
	if locked != nil { result["Locked"] = *locked }
	if sentryMode != nil { result["SentryMode"] = *sentryMode }
	if doorState != nil { result["DoorState"] = *doorState }
	if centerDisp != nil { result["CenterDisplay"] = *centerDisp }
	if fdWindow != nil { result["FdWindow"] = *fdWindow }
	if fpWindow != nil { result["FpWindow"] = *fpWindow }
	if rdWindow != nil { result["RdWindow"] = *rdWindow }
	if rpWindow != nil { result["RpWindow"] = *rpWindow }
	if tpFL != nil { result["TpmsPressureFl"] = *tpFL }
	if tpFR != nil { result["TpmsPressureFr"] = *tpFR }
	if tpRL != nil { result["TpmsPressureRl"] = *tpRL }
	if tpRR != nil { result["TpmsPressureRr"] = *tpRR }
	if vehicleName != nil { result["VehicleName"] = *vehicleName }
	if carType != nil { result["CarType"] = *carType }
	if version != nil { result["Version"] = *version }
	// Vehicle State signals
	if guestMode != nil { result["GuestModeEnabled"] = *guestMode }
	if guestMobileAccess != nil { result["GuestModeMobileAccessState"] = *guestMobileAccess }
	if homelinkNearby != nil { result["HomelinkNearby"] = *homelinkNearby }
	if homelinkDevCount != nil { result["HomelinkDeviceCount"] = *homelinkDevCount }
	if driverSeatOccupied != nil { result["DriverSeatOccupied"] = *driverSeatOccupied }
	if speedLimitMode != nil { result["SpeedLimitMode"] = *speedLimitMode }
	if valetMode != nil { result["ValetModeEnabled"] = *valetMode }
	if serviceMode != nil { result["ServiceMode"] = *serviceMode }
	if currentLimitMph != nil { result["CurrentLimitMph"] = *currentLimitMph }
	if pairedKeyCount != nil { result["PairedPhoneKeyAndKeyFobQty"] = *pairedKeyCount }
	if lightsHazards != nil { result["LightsHazardsActive"] = *lightsHazards }
	if lightsHighBeams != nil { result["LightsHighBeams"] = *lightsHighBeams }
	if lightsTurnSignal != nil { result["LightsTurnSignal"] = *lightsTurnSignal }
	if driverSeatBelt != nil { result["DriverSeatBelt"] = *driverSeatBelt }
	if passengerSeatBelt != nil { result["PassengerSeatBelt"] = *passengerSeatBelt }
	if swUpdateVersion != nil { result["SoftwareUpdateVersion"] = *swUpdateVersion }
	if swDownloadPct != nil { result["SoftwareUpdateDownloadPercentComplete"] = *swDownloadPct }
	if swInstallPct != nil { result["SoftwareUpdateInstallationPercentComplete"] = *swInstallPct }
	if swExpectedDur != nil { result["SoftwareUpdateExpectedDurationMinutes"] = *swExpectedDur }
	if swScheduledStart != nil { result["SoftwareUpdateScheduledStartTime"] = *swScheduledStart }
	// Vehicle Configuration
	if trimVal != nil { result["Trim"] = *trimVal }
	if roofColor != nil { result["RoofColor"] = *roofColor }
	if efficiencyPkg != nil { result["EfficiencyPackage"] = *efficiencyPkg }
	if rearSeatHeaters != nil { result["RearSeatHeaters"] = *rearSeatHeaters }
	if sunroofInstalled != nil { result["SunroofInstalled"] = *sunroofInstalled }
	if europeVehicle != nil { result["EuropeVehicle"] = *europeVehicle }
	if rightHandDrive != nil { result["RightHandDrive"] = *rightHandDrive }
	if remoteStartEnabled != nil { result["RemoteStartEnabled"] = *remoteStartEnabled }
	if offroadLightbar != nil { result["OffroadLightbarPresent"] = *offroadLightbar }
	// State machine recovery
	if lastGearDB != nil { result["_LastGear"] = *lastGearDB }
	if lastSpeedTimeDB != nil { result["_LastSpeedTime"] = *lastSpeedTimeDB }

	return result, nil
}

func toFloat64(v interface{}) (float64, bool) {
	// Unwrap {"value": X} envelopes
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return 0, false
		}
	}
	switch val := v.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	}
	return 0, false
}
