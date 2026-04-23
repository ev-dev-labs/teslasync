package models

import "time"

// SignalObservation mirrors a row in the cold-path tall hypertable
// `signal_observations` (ADR-002 hot/cold split). Low-frequency signals
// that are not promoted to typed columns on positions/charging_telemetry/etc
// land here, keyed by (vehicle_id, ts, signal_name).
//
// Exactly one of ValueNumeric / ValueText / ValueBool is populated per row,
// dictated by the corresponding signal_catalog.data_kind.
type SignalObservation struct {
	VehicleID    int64     `db:"vehicle_id"   json:"vehicle_id"`
	Ts           time.Time `db:"ts"           json:"ts"`
	SignalName   string    `db:"signal_name"  json:"signal_name"`
	ValueNumeric *float64  `db:"value_numeric" json:"value_numeric"`
	ValueText    *string   `db:"value_text"   json:"value_text"`
	ValueBool    *bool     `db:"value_bool"   json:"value_bool"`
	Source       string    `db:"source"       json:"source"`
}

// SignalCatalog mirrors a row in the `signal_catalog` registry table
// (ADR-009 onboarding source of truth). Every signal name ever seen is
// recorded here; signal_observations.signal_name FKs into this table.
type SignalCatalog struct {
	Name             string    `db:"name"              json:"name"`
	FirstSeenAt      time.Time `db:"first_seen_at"     json:"first_seen_at"`
	LastSeenAt       time.Time `db:"last_seen_at"      json:"last_seen_at"`
	ObservationCount int64     `db:"observation_count" json:"observation_count"`
	StorageTier      string    `db:"storage_tier"      json:"storage_tier"`
	TypedTable       *string   `db:"typed_table"       json:"typed_table"`
	TypedColumn      *string   `db:"typed_column"      json:"typed_column"`
	DataKind         *string   `db:"data_kind"         json:"data_kind"`
	Unit             *string   `db:"unit"              json:"unit"`
	Notes            *string   `db:"notes"             json:"notes"`
	CreatedAt        time.Time `db:"created_at"        json:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"        json:"updated_at"`
}

// IsHot reports whether this catalog entry has been promoted to a typed
// column on a hot-path table. When true, TypedTable and TypedColumn are
// expected to be non-nil.
func (c SignalCatalog) IsHot() bool {
	return c.StorageTier == "hot"
}

// IsDropped reports whether ingestion silently skips this signal.
func (c SignalCatalog) IsDropped() bool {
	return c.StorageTier == "dropped"
}
