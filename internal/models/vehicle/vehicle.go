package vehicle

import "time"

// Vehicle is the root entity. Every FK in the schema chains back here.
//
// Mirrors the `vehicles` table after migration 000142_baseline_typed.
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs.
type Vehicle struct {
	ID          int64   `db:"id"           json:"id"`
	TeslaID     int64   `db:"tesla_id"     json:"tesla_id"`
	VIN         string  `db:"vin"          json:"vin"`
	DisplayName string  `db:"display_name" json:"display_name"`
	Model       *string `db:"model"        json:"model,omitempty"`
	OptionCodes *string `db:"option_codes" json:"option_codes,omitempty"`
	Color       *string `db:"color"        json:"color,omitempty"`
	TrimLevel   *string `db:"trim_level"   json:"trim_level,omitempty"`
	// Timezone is the IANA tz database name reported by Tesla
	// (vehicle_state.timezone, e.g. "America/Los_Angeles"). Updated on
	// every successful vehicle_data poll. Defaults to "UTC"; the frontend
	// treats "UTC" as "fall back to user TZ" so streaming-only vehicles
	// that never reach the polling path render gracefully.
	Timezone   string     `db:"timezone"     json:"timezone"`
	EnrolledAt time.Time  `db:"enrolled_at"  json:"enrolled_at"`
	ArchivedAt *time.Time `db:"archived_at"  json:"archived_at,omitempty"`
	CreatedAt  time.Time  `db:"created_at"   json:"created_at"`
	UpdatedAt  time.Time  `db:"updated_at"   json:"updated_at"`
}

// IsActive reports whether the vehicle has not been soft-deleted.
func (v *Vehicle) IsActive() bool { return v.ArchivedAt == nil }

// SoftwareUpdate represents a vehicle software update.
type SoftwareUpdate struct {
	ID          int64      `json:"id" db:"id"`
	VehicleID   int64      `json:"vehicle_id" db:"vehicle_id"`
	Version     string     `json:"version" db:"version"`
	Status      string     `json:"status" db:"status"` // available, downloading, installing, installed
	ScheduledAt *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	InstalledAt *time.Time `json:"installed_at,omitempty" db:"installed_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
}

// VehicleState represents a snapshot of vehicle state at a point in time.
type VehicleState struct {
	VehicleID       int64      `json:"vehicle_id"`
	State           string     `json:"state"`
	Since           *time.Time `json:"since,omitempty"`
	Latitude        float64    `json:"latitude"`
	Longitude       float64    `json:"longitude"`
	Heading         *float64   `json:"heading,omitempty"`
	Speed           float64    `json:"speed"`
	Power           float64    `json:"power"`
	BatteryLevel    int        `json:"battery_level"`
	RatedRange      float64    `json:"rated_range"`
	IdealRange      float64    `json:"ideal_range"`
	Odometer        float64    `json:"odometer"`
	InsideTemp      float64    `json:"inside_temp"`
	OutsideTemp     float64    `json:"outside_temp"`
	IsClimateOn     bool       `json:"is_climate_on"`
	IsCharging      bool       `json:"is_charging"`
	ChargerPower    float64    `json:"charger_power"`
	ChargeRate      float64    `json:"charge_rate"`
	TimeToFullChg   float64    `json:"time_to_full_charge"`
	IsLocked        bool       `json:"is_locked"`
	SentryMode      bool       `json:"sentry_mode"`
	SoftwareVersion string     `json:"software_version"`
}

// CommandLog records a vehicle command execution.
type CommandLog struct {
	ID        int64     `json:"id" db:"id"`
	VehicleID int64     `json:"vehicle_id" db:"vehicle_id"`
	Command   string    `json:"command" db:"command"`
	Params    string    `json:"params,omitempty" db:"params"`
	Status    string    `json:"status" db:"status"` // success, failed, pending
	Error     string    `json:"error,omitempty" db:"error"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// TirePressureSnapshot represents a point-in-time tire pressure reading.
type TirePressureSnapshot struct {
	ID             int64      `json:"id" db:"id"`
	VehicleID      int64      `json:"vehicle_id" db:"vehicle_id"`
	FrontLeft      *float64   `json:"front_left" db:"front_left"`
	FrontRight     *float64   `json:"front_right" db:"front_right"`
	RearLeft       *float64   `json:"rear_left" db:"rear_left"`
	RearRight      *float64   `json:"rear_right" db:"rear_right"`
	TpmsHardWarn   *string    `json:"tpms_hard_warnings,omitempty" db:"tpms_hard_warnings"`
	TpmsSoftWarn   *string    `json:"tpms_soft_warnings,omitempty" db:"tpms_soft_warnings"`
	LastSeenTimeFl *time.Time `json:"last_seen_time_fl,omitempty" db:"last_seen_time_fl"`
	LastSeenTimeFr *time.Time `json:"last_seen_time_fr,omitempty" db:"last_seen_time_fr"`
	LastSeenTimeRl *time.Time `json:"last_seen_time_rl,omitempty" db:"last_seen_time_rl"`
	LastSeenTimeRr *time.Time `json:"last_seen_time_rr,omitempty" db:"last_seen_time_rr"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// VampireDrainEvent represents an energy loss event while parked.
type VampireDrainEvent struct {
	ID                int64      `json:"id" db:"id"`
	VehicleID         int64      `json:"vehicle_id" db:"vehicle_id"`
	StartDate         time.Time  `json:"start_date" db:"start_date"`
	EndDate           *time.Time `json:"end_date,omitempty" db:"end_date"`
	StartBattery      int        `json:"start_battery" db:"start_battery"`
	EndBattery        *int       `json:"end_battery,omitempty" db:"end_battery"`
	BatteryLost       int        `json:"battery_lost" db:"battery_lost"`
	RangeLostKm       float64    `json:"range_lost_km" db:"range_lost_km"`
	DurationHours     float64    `json:"duration_hours" db:"duration_hours"`
	DrainRatePctPerHr float64    `json:"drain_rate_pct_per_hour" db:"drain_rate_pct_per_hour"`
	OutsideTempAvg    *float64   `json:"outside_temp_avg,omitempty" db:"outside_temp_avg"`
	SentryMode        bool       `json:"sentry_mode" db:"sentry_mode"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
}

// MediaSnapshot represents a point-in-time media playback telemetry reading.
type MediaSnapshot struct {
	ID                   int64     `json:"id" db:"id"`
	VehicleID            int64     `json:"vehicle_id" db:"vehicle_id"`
	NowPlayingTitle      *string   `json:"now_playing_title,omitempty" db:"now_playing_title"`
	NowPlayingArtist     *string   `json:"now_playing_artist,omitempty" db:"now_playing_artist"`
	NowPlayingAlbum      *string   `json:"now_playing_album,omitempty" db:"now_playing_album"`
	NowPlayingStation    *string   `json:"now_playing_station,omitempty" db:"now_playing_station"`
	NowPlayingDuration   *int      `json:"now_playing_duration,omitempty" db:"now_playing_duration"`
	NowPlayingElapsed    *int      `json:"now_playing_elapsed,omitempty" db:"now_playing_elapsed"`
	PlaybackStatus       *string   `json:"playback_status,omitempty" db:"playback_status"`
	PlaybackSource       *string   `json:"playback_source,omitempty" db:"playback_source"`
	AudioVolume          *float64  `json:"audio_volume,omitempty" db:"audio_volume"`
	AudioVolumeMax       *float64  `json:"audio_volume_max,omitempty" db:"audio_volume_max"`
	AudioVolumeIncrement *float64  `json:"audio_volume_increment,omitempty" db:"audio_volume_increment"`
	CreatedAt            time.Time `json:"created_at" db:"created_at"`
}

// VehicleConfigSnapshot represents a point-in-time vehicle configuration snapshot.
type VehicleConfigSnapshot struct {
	ID                             int64     `json:"id" db:"id"`
	VehicleID                      int64     `json:"vehicle_id" db:"vehicle_id"`
	CarType                        *string   `json:"car_type,omitempty" db:"car_type"`
	Trim                           *string   `json:"trim,omitempty" db:"trim"`
	ExteriorColor                  *string   `json:"exterior_color,omitempty" db:"exterior_color"`
	RoofColor                      *string   `json:"roof_color,omitempty" db:"roof_color"`
	WheelType                      *string   `json:"wheel_type,omitempty" db:"wheel_type"`
	RearSeatHeaters                *string   `json:"rear_seat_heaters,omitempty" db:"rear_seat_heaters"`
	SunroofInstalled               *string   `json:"sunroof_installed,omitempty" db:"sunroof_installed"`
	EfficiencyPackage              *string   `json:"efficiency_package,omitempty" db:"efficiency_package"`
	EuropeVehicle                  *bool     `json:"europe_vehicle,omitempty" db:"europe_vehicle"`
	RightHandDrive                 *bool     `json:"right_hand_drive,omitempty" db:"right_hand_drive"`
	RemoteStartEnabled             *bool     `json:"remote_start_enabled,omitempty" db:"remote_start_enabled"`
	ChargePort                     *string   `json:"charge_port,omitempty" db:"charge_port"`
	OffroadLightbarPresent         *bool     `json:"offroad_lightbar_present,omitempty" db:"offroad_lightbar_present"`
	Version                        *string   `json:"version,omitempty" db:"version"`
	VehicleName                    *string   `json:"vehicle_name,omitempty" db:"vehicle_name"`
	SoftwareUpdateVersion          *string   `json:"software_update_version,omitempty" db:"software_update_version"`
	SoftwareUpdateDownloadPct      *int      `json:"software_update_download_pct,omitempty" db:"software_update_download_pct"`
	SoftwareUpdateInstallPct       *int      `json:"software_update_install_pct,omitempty" db:"software_update_install_pct"`
	SoftwareUpdateExpectedDuration *int      `json:"software_update_expected_duration,omitempty" db:"software_update_expected_duration"`
	SoftwareUpdateScheduledStart   *string   `json:"software_update_scheduled_start,omitempty" db:"software_update_scheduled_start"`
	CreatedAt                      time.Time `json:"created_at" db:"created_at"`
}

// LocationSnapshot represents a point-in-time navigation/location telemetry reading.
type LocationSnapshot struct {
	ID                int64      `json:"id" db:"id"`
	VehicleID         int64      `json:"vehicle_id" db:"vehicle_id"`
	DestinationName   *string    `json:"destination_name,omitempty" db:"destination_name"`
	DestinationLat    *float64   `json:"destination_lat,omitempty" db:"destination_lat"`
	DestinationLon    *float64   `json:"destination_lon,omitempty" db:"destination_lon"`
	OriginLat         *float64   `json:"origin_lat,omitempty" db:"origin_lat"`
	OriginLon         *float64   `json:"origin_lon,omitempty" db:"origin_lon"`
	MilesToArrival    *float64   `json:"miles_to_arrival,omitempty" db:"miles_to_arrival"`
	MinutesToArrival  *float64   `json:"minutes_to_arrival,omitempty" db:"minutes_to_arrival"`
	RouteLine         *string    `json:"route_line,omitempty" db:"route_line"`
	LocatedAtHome     *bool      `json:"located_at_home,omitempty" db:"located_at_home"`
	LocatedAtWork     *bool      `json:"located_at_work,omitempty" db:"located_at_work"`
	LocatedAtFavorite *bool      `json:"located_at_favorite,omitempty" db:"located_at_favorite"`
	GpsState          *string    `json:"gps_state,omitempty" db:"gps_state"`
	RouteLastUpdated  *time.Time `json:"route_last_updated,omitempty" db:"route_last_updated"`
	CurrentLat        *float64   `json:"current_lat,omitempty" db:"current_lat"`
	CurrentLon        *float64   `json:"current_lon,omitempty" db:"current_lon"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
}

// SafetySnapshot represents a point-in-time safety settings telemetry reading.
type SafetySnapshot struct {
	ID                              int64     `json:"id" db:"id"`
	VehicleID                       int64     `json:"vehicle_id" db:"vehicle_id"`
	AutomaticBlindSpotCamera        *bool     `json:"automatic_blind_spot_camera,omitempty" db:"automatic_blind_spot_camera"`
	AutomaticEmergencyBrakingOff    *bool     `json:"automatic_emergency_braking_off,omitempty" db:"automatic_emergency_braking_off"`
	BlindSpotCollisionWarning       *bool     `json:"blind_spot_collision_warning,omitempty" db:"blind_spot_collision_warning"`
	CruiseFollowDistance            *string   `json:"cruise_follow_distance,omitempty" db:"cruise_follow_distance"`
	EmergencyLaneDepartureAvoidance *bool     `json:"emergency_lane_departure_avoidance,omitempty" db:"emergency_lane_departure_avoidance"`
	ForwardCollisionWarning         *string   `json:"forward_collision_warning,omitempty" db:"forward_collision_warning"`
	LaneDepartureAvoidance          *string   `json:"lane_departure_avoidance,omitempty" db:"lane_departure_avoidance"`
	SpeedLimitWarning               *string   `json:"speed_limit_warning,omitempty" db:"speed_limit_warning"`
	PinToDriveEnabled               *bool     `json:"pin_to_drive_enabled,omitempty" db:"pin_to_drive_enabled"`
	MilesSinceReset                 *float64  `json:"miles_since_reset,omitempty" db:"miles_since_reset"`
	SelfDrivingMilesSinceReset      *float64  `json:"self_driving_miles_since_reset,omitempty" db:"self_driving_miles_since_reset"`
	CreatedAt                       time.Time `json:"created_at" db:"created_at"`
}

// UserPreferenceSnapshot represents a point-in-time user preference telemetry reading.
type UserPreferenceSnapshot struct {
	ID                      int64     `json:"id" db:"id"`
	VehicleID               int64     `json:"vehicle_id" db:"vehicle_id"`
	Setting24hrTime         *bool     `json:"setting_24hr_time,omitempty" db:"setting_24hr_time"`
	SettingChargeUnit       *string   `json:"setting_charge_unit,omitempty" db:"setting_charge_unit"`
	SettingDistanceUnit     *string   `json:"setting_distance_unit,omitempty" db:"setting_distance_unit"`
	SettingTemperatureUnit  *string   `json:"setting_temperature_unit,omitempty" db:"setting_temperature_unit"`
	SettingTirePressureUnit *string   `json:"setting_tire_pressure_unit,omitempty" db:"setting_tire_pressure_unit"`
	CreatedAt               time.Time `json:"created_at" db:"created_at"`
}

// GuardConfig holds per-vehicle anti-theft guard mode configuration.
type GuardConfig struct {
	VehicleID      int64     `json:"vehicle_id" db:"vehicle_id"`
	Enabled        bool      `json:"enabled" db:"enabled"`
	HomeGeofenceID *int64    `json:"home_geofence_id" db:"home_geofence_id"`
	Sensitivity    string    `json:"sensitivity" db:"sensitivity"`
	AutoPanic      bool      `json:"auto_panic" db:"auto_panic"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
}

// GuardEvent records a guard mode alert (movement, unlock, panic, etc.).
type GuardEvent struct {
	ID               int64                  `json:"id" db:"id"`
	VehicleID        int64                  `json:"vehicle_id" db:"vehicle_id"`
	EventType        string                 `json:"event_type" db:"event_type"`
	Latitude         *float64               `json:"latitude" db:"latitude"`
	Longitude        *float64               `json:"longitude" db:"longitude"`
	Speed            *float64               `json:"speed" db:"speed"`
	Details          map[string]interface{} `json:"details" db:"details"`
	NotifiedChannels []string               `json:"notified_channels" db:"notified_channels"`
	Acknowledged     bool                   `json:"acknowledged" db:"acknowledged"`
	AcknowledgedAt   *time.Time             `json:"acknowledged_at" db:"acknowledged_at"`
	CreatedAt        time.Time              `json:"created_at" db:"created_at"`
}
