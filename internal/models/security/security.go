package security

import "time"

// SecurityEvent is the persistence + transport DTO for one row of the
// `security_events` hypertable — the append-only state-change log for
// vehicle security/safety transitions (lock/unlock, sentry on/off,
// door/window open/close, airbag deployed, crash-state change, ...).
//
// Schema source of truth: `security_events` was DROPped and recreated
// with typed columns by migrations/000183_snapshots_si.up.sql (see the
// CREATE TABLE at line 197), then augmented with a sequence-backed
// surrogate `id` and the acknowledgement columns by
// migrations/000189_security_events_ack.up.sql. This struct mirrors that
// CURRENT schema exactly. The earlier baseline shape
// (doors_open/windows_open/locked/sentry_mode/user_present/detail/source
// from migrations/000142_baseline_typed.up.sql) no longer exists on disk
// and MUST NOT be reintroduced here.
//
// db/json tags match the live column names one-for-one, so the same
// struct round-trips through a pgx scan and the REST JSON envelope. The
// live guard read-path (internal/database/system.GuardEvent) selects
// this exact column set — keep the two shapes aligned.
//
// Design: append-only. Every change is a NEW row (only the
// acknowledgement columns are ever UPDATEd). FromState is nil for the
// first observation after process start; ToState carries the new value
// token. Details is optional, event_type-specific structured context
// (JSONB). Nullable columns are pointer / map types so an absent value
// serialises as JSON `null` rather than a misleading zero value.
//
// Primary key: (vehicle_id, ts, event_type). `id` is a surrogate for
// single-row REST addressing (POST /guard/events/{id}/acknowledge), not
// the natural key.
type SecurityEvent struct {
	ID             int64          `db:"id" json:"id"`
	VehicleID      int64          `db:"vehicle_id" json:"vehicle_id"`
	Ts             time.Time      `db:"ts" json:"ts"`
	EventType      string         `db:"event_type" json:"event_type"`
	FromState      *string        `db:"from_state" json:"from_state"`
	ToState        *string        `db:"to_state" json:"to_state"`
	Details        map[string]any `db:"details" json:"details"`
	AcknowledgedAt *time.Time     `db:"acknowledged_at" json:"acknowledged_at"`
	AcknowledgedBy *string        `db:"acknowledged_by" json:"acknowledged_by"`
}

// Acknowledged reports whether the event has been acknowledged. It
// mirrors the frontend's derivation (`acknowledged: boolean` from
// `acknowledged_at != null`, see internal/database/system.GuardEvent) so
// the backend and UI agree on a single rule.
//
// Nil-safe: a nil receiver — and the zero value, whose AcknowledgedAt is
// nil — are both reported as unacknowledged, so callers can evaluate a
// possibly-absent event without a preceding nil check.
func (e *SecurityEvent) Acknowledged() bool {
	return e != nil && e.AcknowledgedAt != nil
}
