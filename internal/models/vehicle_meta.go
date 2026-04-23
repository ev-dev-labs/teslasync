package models

import "time"

// VehicleMetaSnapshot mirrors the post-migration `vehicle_meta_snapshots` table.
//
// ADR-003: this is a single consolidated low-frequency hypertable that replaces
// five legacy snapshot tables (tire_pressure_snapshots, media_snapshots,
// safety_snapshots, vehicle_config_snapshots, user_preference_snapshots).
// The `category` discriminator selects which column group is populated; all
// other groups remain NULL and compress to ~zero cost in the columnstore.
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs. Every column
// in the schema is represented as a typed Go field (pointer for nullable).
//
// See migration 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/_baseline_source/10-vehicle-meta-snapshots.sql.
type VehicleMetaSnapshot struct {
	VehicleID int64     `db:"vehicle_id" json:"vehicle_id"`
	Ts        time.Time `db:"ts"         json:"ts"`
	Category  string    `db:"category"   json:"category"`

	// Tire (category='tire')
	TirePressureFLPSI *float64 `db:"tire_pressure_fl_psi" json:"tire_pressure_fl_psi,omitempty"`
	TirePressureFRPSI *float64 `db:"tire_pressure_fr_psi" json:"tire_pressure_fr_psi,omitempty"`
	TirePressureRLPSI *float64 `db:"tire_pressure_rl_psi" json:"tire_pressure_rl_psi,omitempty"`
	TirePressureRRPSI *float64 `db:"tire_pressure_rr_psi" json:"tire_pressure_rr_psi,omitempty"`
	TireTempFLC       *float64 `db:"tire_temp_fl_c"       json:"tire_temp_fl_c,omitempty"`
	TireTempFRC       *float64 `db:"tire_temp_fr_c"       json:"tire_temp_fr_c,omitempty"`
	TireTempRLC       *float64 `db:"tire_temp_rl_c"       json:"tire_temp_rl_c,omitempty"`
	TireTempRRC       *float64 `db:"tire_temp_rr_c"       json:"tire_temp_rr_c,omitempty"`

	// Media (category='media')
	MediaSource           *string  `db:"media_source"             json:"media_source,omitempty"`
	MediaTrackTitle       *string  `db:"media_track_title"        json:"media_track_title,omitempty"`
	MediaTrackArtist      *string  `db:"media_track_artist"       json:"media_track_artist,omitempty"`
	MediaTrackAlbum       *string  `db:"media_track_album"        json:"media_track_album,omitempty"`
	MediaVolume           *float64 `db:"media_volume"             json:"media_volume,omitempty"`
	MediaIsPlaying        *bool    `db:"media_is_playing"         json:"media_is_playing,omitempty"`
	MediaTrackDurationSec *int32   `db:"media_track_duration_sec" json:"media_track_duration_sec,omitempty"`

	// Safety (category='safety')
	AutopilotState      *string `db:"autopilot_state"       json:"autopilot_state,omitempty"`
	FCWActive           *bool   `db:"fcw_active"            json:"fcw_active,omitempty"`
	BlindSpotActive     *bool   `db:"blind_spot_active"     json:"blind_spot_active,omitempty"`
	EmergencyLaneAssist *bool   `db:"emergency_lane_assist" json:"emergency_lane_assist,omitempty"`
	ABSActive           *bool   `db:"abs_active"            json:"abs_active,omitempty"`
	SpeedLimitMode      *string `db:"speed_limit_mode"      json:"speed_limit_mode,omitempty"`

	// Config (category='config')
	SoftwareVersion  *string `db:"software_version"   json:"software_version,omitempty"`
	CarType          *string `db:"car_type"           json:"car_type,omitempty"`
	ExteriorColor    *string `db:"exterior_color"     json:"exterior_color,omitempty"`
	WheelType        *string `db:"wheel_type"         json:"wheel_type,omitempty"`
	SpoilerType      *string `db:"spoiler_type"       json:"spoiler_type,omitempty"`
	HasLudicrousMode *bool   `db:"has_ludicrous_mode" json:"has_ludicrous_mode,omitempty"`

	// Preference (category='preference')
	DriveMode         *string `db:"drive_mode"          json:"drive_mode,omitempty"`
	RegenLevel        *string `db:"regen_level"         json:"regen_level,omitempty"`
	SteeringMode      *string `db:"steering_mode"       json:"steering_mode,omitempty"`
	AccelerationMode  *string `db:"acceleration_mode"   json:"acceleration_mode,omitempty"`
	ClimateKeeperMode *string `db:"climate_keeper_mode" json:"climate_keeper_mode,omitempty"`
	PetMode           *bool   `db:"pet_mode"            json:"pet_mode,omitempty"`

	Source string `db:"source" json:"source"`
}

// Category discriminator values for VehicleMetaSnapshot. Matches the CHECK
// constraint on vehicle_meta_snapshots.category.
const (
	VehicleMetaCategoryTire       = "tire"
	VehicleMetaCategoryMedia      = "media"
	VehicleMetaCategorySafety     = "safety"
	VehicleMetaCategoryConfig     = "config"
	VehicleMetaCategoryPreference = "preference"
)
