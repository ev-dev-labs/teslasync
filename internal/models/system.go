package models

import "time"

// =============================================================================
// system.go — Go models for the system / admin / runtime tables defined in
// migration 000142_baseline_typed (Phase 3 schema 23-system-tables.sql).
//
// One Go struct per table. Snake_case `db` and `json` tags mirror the
// column names exactly. Nullable columns use pointer types. No `raw_json`,
// no JSONB carve-outs (ADR-001, ADR-005). The `embeddings` vector column is
// the sole exception — it uses pgvector and is exposed as a typed slice.
// =============================================================================

// SettingsKind enumerates the valid `data_kind` values for a Setting row.
type SettingsKind string

const (
	SettingsKindText    SettingsKind = "text"
	SettingsKindNumber  SettingsKind = "number"
	SettingsKindBoolean SettingsKind = "boolean"
)

// Setting mirrors the post-migration `settings` schema (typed key-value store).
// Exactly one of ValueText / ValueNum / ValueBool is meaningful, selected by DataKind.
type Setting struct {
	Key         string       `db:"key" json:"key"`
	ValueText   *string      `db:"value_text" json:"value_text,omitempty"`
	ValueNum    *float64     `db:"value_num" json:"value_num,omitempty"`
	ValueBool   *bool        `db:"value_bool" json:"value_bool,omitempty"`
	DataKind    SettingsKind `db:"data_kind" json:"data_kind"`
	Description *string      `db:"description" json:"description,omitempty"`
	CreatedAt   time.Time    `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time    `db:"updated_at" json:"updated_at"`
}

// PollingConfig mirrors the post-migration `polling_config` schema
// (per-vehicle polling tuning). VehicleID is the primary key (1:1 with vehicles).
type PollingConfig struct {
	VehicleID          int64     `db:"vehicle_id" json:"vehicle_id"`
	AwakeIntervalSec   int32     `db:"awake_interval_sec" json:"awake_interval_sec"`
	AsleepIntervalSec  int32     `db:"asleep_interval_sec" json:"asleep_interval_sec"`
	DrivingIntervalSec int32     `db:"driving_interval_sec" json:"driving_interval_sec"`
	Enabled            bool      `db:"enabled" json:"enabled"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at" json:"updated_at"`
}

// PlaceCategory enumerates the valid `category` values for a Place row.
type PlaceCategory string

const (
	PlaceCategoryHome     PlaceCategory = "home"
	PlaceCategoryWork     PlaceCategory = "work"
	PlaceCategoryCharging PlaceCategory = "charging"
	PlaceCategoryCustom   PlaceCategory = "custom"
)

// Place mirrors the post-migration `places` schema (named locations).
type Place struct {
	ID        int64          `db:"id" json:"id"`
	Name      string         `db:"name" json:"name"`
	Latitude  float64        `db:"latitude" json:"latitude"`
	Longitude float64        `db:"longitude" json:"longitude"`
	RadiusM   int32          `db:"radius_m" json:"radius_m"`
	Category  *PlaceCategory `db:"category" json:"category,omitempty"`
	CreatedAt time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt time.Time      `db:"updated_at" json:"updated_at"`
}

// GeofenceCategory enumerates the valid `category` values for a Geofence row.
type GeofenceCategory string

const (
	GeofenceCategoryHome       GeofenceCategory = "home"
	GeofenceCategoryWork       GeofenceCategory = "work"
	GeofenceCategoryRestricted GeofenceCategory = "restricted"
	GeofenceCategoryCustom     GeofenceCategory = "custom"
)

// Geofence mirrors the post-migration `geofences` schema. PolygonWKT is a
// Well-Known Text POLYGON((lon lat, ...)) parsed at runtime — not server-side.
type Geofence struct {
	ID         int64             `db:"id" json:"id"`
	Name       string            `db:"name" json:"name"`
	PolygonWKT string            `db:"polygon_wkt" json:"polygon_wkt"`
	Category   *GeofenceCategory `db:"category" json:"category,omitempty"`
	CreatedAt  time.Time         `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time         `db:"updated_at" json:"updated_at"`
}

// ElectricityCost mirrors the post-migration `electricity_cost` schema
// (time-of-use rate schedule). RatePerKwh is numeric(10,6); represented as
// float64 since the rate has a fixed magnitude well within float64 precision.
// StartTime/EndTime are SQL `time` values; represented as time.Time with the
// date component unused (consumers should read only the clock portion).
type ElectricityCost struct {
	ID            int64      `db:"id" json:"id"`
	Region        string     `db:"region" json:"region"`
	StartTime     time.Time  `db:"start_time" json:"start_time"`
	EndTime       time.Time  `db:"end_time" json:"end_time"`
	RatePerKwh    float64    `db:"rate_per_kwh" json:"rate_per_kwh"`
	Currency      string     `db:"currency" json:"currency"`
	EffectiveFrom time.Time  `db:"effective_from" json:"effective_from"`
	EffectiveTo   *time.Time `db:"effective_to" json:"effective_to,omitempty"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
}

// GasGrade enumerates the valid `grade` values for a GasPrice row.
type GasGrade string

const (
	GasGradeRegular  GasGrade = "regular"
	GasGradeMidgrade GasGrade = "midgrade"
	GasGradePremium  GasGrade = "premium"
	GasGradeDiesel   GasGrade = "diesel"
)

// GasPrice mirrors the post-migration `gas_prices` schema (append-only
// regional gas-price snapshots; no updated_at).
type GasPrice struct {
	ID             int64     `db:"id" json:"id"`
	Ts             time.Time `db:"ts" json:"ts"`
	Region         string    `db:"region" json:"region"`
	Grade          GasGrade  `db:"grade" json:"grade"`
	PricePerGallon float64   `db:"price_per_gallon" json:"price_per_gallon"`
	Currency       string    `db:"currency" json:"currency"`
	Source         string    `db:"source" json:"source"`
}

// AuditLog mirrors the post-migration `audit_logs` schema (append-only;
// composite PK (ts, id); no updated_at).
type AuditLog struct {
	ID         int64     `db:"id" json:"id"`
	Ts         time.Time `db:"ts" json:"ts"`
	Actor      string    `db:"actor" json:"actor"`
	Action     string    `db:"action" json:"action"`
	EntityType string    `db:"entity_type" json:"entity_type"`
	EntityID   *int64    `db:"entity_id" json:"entity_id,omitempty"`
	Detail     *string   `db:"detail" json:"detail,omitempty"`
}

// CommandStatus enumerates the valid `status` values for a CommandExecution row.
type CommandStatus string

const (
	CommandStatusQueued    CommandStatus = "queued"
	CommandStatusRunning   CommandStatus = "running"
	CommandStatusSucceeded CommandStatus = "succeeded"
	CommandStatusFailed    CommandStatus = "failed"
	CommandStatusTimedOut  CommandStatus = "timed_out"
)

// CommandExecution mirrors the post-migration `command_executions` schema
// (append-only Tesla command invocation log; composite PK (ts, id)).
type CommandExecution struct {
	ID           int64         `db:"id" json:"id"`
	Ts           time.Time     `db:"ts" json:"ts"`
	VehicleID    int64         `db:"vehicle_id" json:"vehicle_id"`
	Command      string        `db:"command" json:"command"`
	InvokedBy    string        `db:"invoked_by" json:"invoked_by"`
	Status       CommandStatus `db:"status" json:"status"`
	DurationMs   *int32        `db:"duration_ms" json:"duration_ms,omitempty"`
	ErrorMessage *string       `db:"error_message" json:"error_message,omitempty"`
}

// IsTerminal reports whether the command has reached a terminal state.
func (c *CommandExecution) IsTerminal() bool {
	if c == nil {
		return false
	}
	switch c.Status {
	case CommandStatusSucceeded, CommandStatusFailed, CommandStatusTimedOut:
		return true
	default:
		return false
	}
}

// FSMTransition mirrors the post-migration `fsm_transitions` schema
// (append-only state machine log; composite PK (ts, id)).
type FSMTransition struct {
	ID        int64     `db:"id" json:"id"`
	Ts        time.Time `db:"ts" json:"ts"`
	VehicleID int64     `db:"vehicle_id" json:"vehicle_id"`
	FromState string    `db:"from_state" json:"from_state"`
	ToState   string    `db:"to_state" json:"to_state"`
	Trigger   *string   `db:"trigger" json:"trigger,omitempty"`
}

// Embedding mirrors the post-migration `embeddings` schema (pgvector-backed).
//
// ADR-005 carve-out: Embedding is the only field permitted to use a non-scalar
// type, since pgvector's vector(384) has no scalar Go equivalent. Repositories
// marshal []float32 ↔ pgvector.Vector at the database boundary.
type Embedding struct {
	ID         int64     `db:"id" json:"id"`
	EntityType string    `db:"entity_type" json:"entity_type"`
	EntityID   int64     `db:"entity_id" json:"entity_id"`
	Embedding  []float32 `db:"embedding" json:"embedding"`
	Model      string    `db:"model" json:"model"`
	CreatedAt  time.Time `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time `db:"updated_at" json:"updated_at"`
}
