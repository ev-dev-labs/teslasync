package security

import "time"

// SecurityEvent mirrors the post-migration `security_events` schema
// introduced in migrations/000142_baseline_typed.up.sql
// (source: migrations/_baseline_source/07-security-events.sql).
//
// Hot hypertable storing event-driven door/lock/sentry history with
// 5-year audit retention per ADR-003. Nullable columns are pointer
// types; db/json tags match column names exactly. Schema is fully
// typed per ADR-005 — no raw_json/JSONB carve-outs.
//
// Primary key: (vehicle_id, ts, event_type).
type SecurityEvent struct {
	VehicleID   int64     `db:"vehicle_id" json:"vehicle_id"`
	Ts          time.Time `db:"ts" json:"ts"`
	EventType   string    `db:"event_type" json:"event_type"`
	DoorsOpen   *string   `db:"doors_open" json:"doors_open"`
	WindowsOpen *string   `db:"windows_open" json:"windows_open"`
	Locked      *bool     `db:"locked" json:"locked"`
	SentryMode  *bool     `db:"sentry_mode" json:"sentry_mode"`
	UserPresent *bool     `db:"user_present" json:"user_present"`
	Detail      *string   `db:"detail" json:"detail"`
	Source      string    `db:"source" json:"source"`
}
