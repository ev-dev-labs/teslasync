package models

import "time"

// Vehicle is the root entity. Every FK in the schema chains back here.
//
// Mirrors the post-migration `vehicles` table (see migration 000142_baseline_typed
// and .github/prompts/db-refactor/phase-3-schema/_baseline_source/01-vehicles.sql).
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs.
type Vehicle struct {
	ID          int64      `db:"id"           json:"id"`
	TeslaID     int64      `db:"tesla_id"     json:"tesla_id"`
	VIN         string     `db:"vin"          json:"vin"`
	DisplayName string     `db:"display_name" json:"display_name"`
	Model       *string    `db:"model"        json:"model,omitempty"`
	OptionCodes *string    `db:"option_codes" json:"option_codes,omitempty"`
	Color       *string    `db:"color"        json:"color,omitempty"`
	TrimLevel   *string    `db:"trim_level"   json:"trim_level,omitempty"`
	EnrolledAt  time.Time  `db:"enrolled_at"  json:"enrolled_at"`
	ArchivedAt  *time.Time `db:"archived_at"  json:"archived_at,omitempty"`
	CreatedAt   time.Time  `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"   json:"updated_at"`
}

// IsActive reports whether the vehicle has not been soft-deleted.
func (v *Vehicle) IsActive() bool { return v.ArchivedAt == nil }
