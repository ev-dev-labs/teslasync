package drive

import "time"

// Drive represents a single driving session.
//
// Mirrors the SI canonical `drives` table (migration 000185_drives_si). All
// quantitative fields are SI canonical:
//
//   - DurationS         seconds (BIGINT in DB)
//   - DistanceM         meters
//   - EnergyUsedWh      watt-hours
//   - RegenEnergyWh     watt-hours
//   - AvgSpeedMps       meters per second
//   - MaxSpeedMps       meters per second
//   - AvgPowerW         watts
//   - OutsideTempAvgC   degrees Celsius (already SI)
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs.
// Field names and storage are SI-canonical; frontend display conversion
// belongs at the useUnits()/lib/unitConversion boundary.
//
// Migration 000185 dropped the inside cabin temp, score, ended status,
// created_at, and updated_at columns. The fields
// remain on the struct as nullable for JSON shape stability and surface
// nil/derived values from scanDrive.
//
// Mutability: rows are mutable while a drive is in progress.
// EndTs is NULL while a drive is in progress (same pattern as ChargingSession).
type Drive struct {
	ID        int64      `db:"id"          json:"id"`
	VehicleID int64      `db:"vehicle_id"  json:"vehicle_id"`
	StartTs   time.Time  `db:"start_ts"    json:"start_ts"`
	EndTs     *time.Time `db:"end_ts"      json:"end_ts"`
	DurationS int64      `db:"duration_s"  json:"duration_s"`
	DistanceM float64    `db:"distance_m"  json:"distance_m"`

	StartAddress *string  `db:"start_address" json:"start_address,omitempty"`
	EndAddress   *string  `db:"end_address"   json:"end_address,omitempty"`
	StartLat     *float64 `db:"start_lat"     json:"start_lat,omitempty"`
	StartLon     *float64 `db:"start_lon"     json:"start_lon,omitempty"`
	EndLat       *float64 `db:"end_lat"       json:"end_lat,omitempty"`
	EndLon       *float64 `db:"end_lon"       json:"end_lon,omitempty"`

	// StartGeofenceID / EndGeofenceID identify the charging-place geofence
	// (if any) matched at each drive endpoint (migration
	// 000228_geofence_charging_place_pricing). Match-only — a drive never
	// auto-creates a geofence. No DB-level FK, for the same hot-path-adjacent
	// reason as StartAddress/EndAddress resolution: written from
	// resolveAndUpdateAddress, which must not be blocked by a synchronous FK
	// check. Renaming the geofence later improves historical display because
	// readers resolve the CURRENT geofence name at read time, falling back to
	// the stored StartAddress/EndAddress text when no geofence matched.
	StartGeofenceID *int64 `db:"start_geofence_id" json:"start_geofence_id,omitempty"`
	EndGeofenceID   *int64 `db:"end_geofence_id"   json:"end_geofence_id,omitempty"`

	StartBatteryPct *int16 `db:"start_battery_pct" json:"start_battery_pct,omitempty"`
	EndBatteryPct   *int16 `db:"end_battery_pct"   json:"end_battery_pct,omitempty"`

	EnergyUsedWh  *float64 `db:"energy_used_wh"  json:"energy_used_wh,omitempty"`
	RegenEnergyWh *float64 `db:"regen_energy_wh" json:"regen_energy_wh,omitempty"`
	AvgSpeedMps   *float64 `db:"avg_speed_mps"   json:"avg_speed_mps,omitempty"`
	MaxSpeedMps   *float64 `db:"max_speed_mps"   json:"max_speed_mps,omitempty"`
	AvgPowerW     *float64 `db:"avg_power_w"     json:"avg_power_w,omitempty"`

	OutsideTempAvgC *float64 `db:"outside_temp_avg_c" json:"outside_temp_avg_c,omitempty"`
	InsideTempAvgC  *float64 `db:"inside_temp_avg_c"  json:"inside_temp_avg_c,omitempty"`

	Score       *float64 `db:"score"        json:"score,omitempty"`
	EndedStatus *string  `db:"ended_status" json:"ended_status,omitempty"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// DriveTelemetryReading represents a single telemetry snapshot during a drive.
type DriveTelemetryReading struct {
	ID              int64     `json:"id" db:"id"`
	DriveID         int64     `json:"drive_id" db:"drive_id"`
	VehicleID       int64     `json:"vehicle_id" db:"vehicle_id"`
	Latitude        *float64  `json:"latitude,omitempty" db:"latitude"`
	Longitude       *float64  `json:"longitude,omitempty" db:"longitude"`
	Elevation       *float64  `json:"elevation,omitempty" db:"elevation"`
	Heading         *int      `json:"heading,omitempty" db:"heading"`
	Odometer        *float64  `json:"odometer,omitempty" db:"odometer"`
	Speed           *float64  `json:"speed,omitempty" db:"speed"`
	Power           *float64  `json:"power,omitempty" db:"power"`
	BatteryLevel    *int      `json:"battery_level,omitempty" db:"battery_level"`
	Soc             *float64  `json:"soc,omitempty" db:"soc"`
	UsableSoc       *float64  `json:"usable_soc,omitempty" db:"usable_soc"`
	RatedRange      *float64  `json:"rated_range,omitempty" db:"rated_range"`
	IdealRange      *float64  `json:"ideal_range,omitempty" db:"ideal_range"`
	EstRange        *float64  `json:"est_range,omitempty" db:"est_range"`
	InsideTemp      *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp     *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	DriverTemp      *float64  `json:"driver_temp,omitempty" db:"driver_temp"`
	PassengerTemp   *float64  `json:"passenger_temp,omitempty" db:"passenger_temp"`
	FanStatus       *int      `json:"fan_status,omitempty" db:"fan_status"`
	IsClimateOn     *bool     `json:"is_climate_on,omitempty" db:"is_climate_on"`
	TirePressureFL  *float64  `json:"tire_pressure_fl,omitempty" db:"tire_pressure_fl"`
	TirePressureFR  *float64  `json:"tire_pressure_fr,omitempty" db:"tire_pressure_fr"`
	TirePressureRL  *float64  `json:"tire_pressure_rl,omitempty" db:"tire_pressure_rl"`
	TirePressureRR  *float64  `json:"tire_pressure_rr,omitempty" db:"tire_pressure_rr"`
	BatteryHeaterOn *bool     `json:"battery_heater_on,omitempty" db:"battery_heater_on"`
	AccelerationGs  *float64  `json:"acceleration_gs,omitempty" db:"acceleration_gs"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// ShareToken represents a public share link for a drive.
type ShareToken struct {
	ID               int64      `json:"id" db:"id"`
	Token            string     `json:"token" db:"token"`
	DriveID          int64      `json:"drive_id" db:"drive_id"`
	CreatedBy        *string    `json:"created_by,omitempty" db:"created_by"`
	Title            *string    `json:"title,omitempty" db:"title"`
	Description      *string    `json:"description,omitempty" db:"description"`
	IncludeMap       bool       `json:"include_map" db:"include_map"`
	IncludeTelemetry bool       `json:"include_telemetry" db:"include_telemetry"`
	IncludeSpeed     bool       `json:"include_speed" db:"include_speed"`
	Views            int        `json:"views" db:"views"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
}
