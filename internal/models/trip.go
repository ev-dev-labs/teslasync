package models

import "time"

// Trip mirrors the post-migration `trips` schema (migration 000142_baseline_typed).
//
// A Trip is a user-defined multi-drive grouping (e.g., a vacation). Totals are
// denormalized for read performance and can be recomputed from the constituent
// drives via the `trip_drives` join table.
//
// Field/column mapping is 1-to-1 with the SQL schema. Nullable columns use
// pointer types. No raw_json or JSONB carve-outs (ADR-001, ADR-005).
type Trip struct {
	ID               int64      `db:"id" json:"id"`
	VehicleID        int64      `db:"vehicle_id" json:"vehicle_id"`
	Name             string     `db:"name" json:"name"`
	Description      *string    `db:"description" json:"description,omitempty"`
	StartTs          time.Time  `db:"start_ts" json:"start_ts"`
	EndTs            *time.Time `db:"end_ts" json:"end_ts,omitempty"`
	TotalDistanceMi  *float64   `db:"total_distance_mi" json:"total_distance_mi,omitempty"`
	TotalEnergyKWh   *float64   `db:"total_energy_kwh" json:"total_energy_kwh,omitempty"`
	TotalDurationMin *float64   `db:"total_duration_min" json:"total_duration_min,omitempty"`
	CreatedAt        time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at" json:"updated_at"`
}

// IsActive reports whether the trip is still in progress (no end timestamp).
func (t *Trip) IsActive() bool {
	return t.EndTs == nil
}
