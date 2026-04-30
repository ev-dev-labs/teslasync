package models

import "time"

// Position is a single GPS + motion sample written at high frequency by
// Fleet Telemetry. Mirrors the post-migration `positions` hypertable
// (see migration 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/_baseline_source/03-positions.sql).
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs.
// ADR-003: hot tier — kept separate from low-frequency snapshots.
// ADR-005: speed/elevation stored in source units (mph / meters); unit
// conversion happens in the API layer, not in the model.
type Position struct {
	VehicleID  int64     `db:"vehicle_id"  json:"vehicle_id"`
	Ts         time.Time `db:"ts"          json:"ts"`
	Latitude   float64   `db:"latitude"    json:"latitude"`
	Longitude  float64   `db:"longitude"   json:"longitude"`
	Heading    *int16    `db:"heading"     json:"heading,omitempty"`
	SpeedMph   *float64  `db:"speed_mph"   json:"speed_mph,omitempty"`
	ElevationM *float64  `db:"elevation_m" json:"elevation_m,omitempty"`
	GpsState   *string   `db:"gps_state"   json:"gps_state,omitempty"`
	Source     string    `db:"source"      json:"source"`
}
