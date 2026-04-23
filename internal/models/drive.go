package models

import "time"

// Drive represents a single completed driving session.
//
// Mirrors the post-migration `drives` table (see migration 000142_baseline_typed
// and .github/prompts/db-refactor/phase-3-schema/_baseline_source/11-drives.sql).
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs.
// ADR-005: distance/speed are stored in miles per repo convention; UI converts
// via useSettings.convertDistance.
//
// Mutability: rows are mutable because re-scoring updates the score column.
type Drive struct {
	ID          int64     `db:"id"           json:"id"`
	VehicleID   int64     `db:"vehicle_id"   json:"vehicle_id"`
	StartTs     time.Time `db:"start_ts"     json:"start_ts"`
	EndTs       time.Time `db:"end_ts"       json:"end_ts"`
	DurationMin float64   `db:"duration_min" json:"duration_min"`
	DistanceMi  float64   `db:"distance_mi"  json:"distance_mi"`

	StartAddress *string  `db:"start_address" json:"start_address,omitempty"`
	EndAddress   *string  `db:"end_address"   json:"end_address,omitempty"`
	StartLat     *float64 `db:"start_lat"     json:"start_lat,omitempty"`
	StartLon     *float64 `db:"start_lon"     json:"start_lon,omitempty"`
	EndLat       *float64 `db:"end_lat"       json:"end_lat,omitempty"`
	EndLon       *float64 `db:"end_lon"       json:"end_lon,omitempty"`

	StartBatteryPct *int16 `db:"start_battery_pct" json:"start_battery_pct,omitempty"`
	EndBatteryPct   *int16 `db:"end_battery_pct"   json:"end_battery_pct,omitempty"`

	EnergyUsedKwh *float64 `db:"energy_used_kwh" json:"energy_used_kwh,omitempty"`
	RegenKwh      *float64 `db:"regen_kwh"       json:"regen_kwh,omitempty"`
	AvgSpeedMph   *float64 `db:"avg_speed_mph"   json:"avg_speed_mph,omitempty"`
	MaxSpeedMph   *float64 `db:"max_speed_mph"   json:"max_speed_mph,omitempty"`
	AvgPowerKw    *float64 `db:"avg_power_kw"    json:"avg_power_kw,omitempty"`

	OutsideTempAvgC *float64 `db:"outside_temp_avg_c" json:"outside_temp_avg_c,omitempty"`
	InsideTempAvgC  *float64 `db:"inside_temp_avg_c"  json:"inside_temp_avg_c,omitempty"`

	Score       *float64 `db:"score"        json:"score,omitempty"`
	EndedStatus *string  `db:"ended_status" json:"ended_status,omitempty"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}
