// Package database — GuardRepo backs the restored /vehicles/{id}/guard*
// endpoints (Phase-43a / Prompt 0006). Phase-42 prompt 0077 deleted the
// legacy guard_events table along with the /guard handler family;
// this repo re-derives the same product surface from security_events
// (mig 000183, augmented in mig 000189 with id + acknowledgement
// columns).
//
// Data model
//
//	A "guard event" is one row in security_events. The natural PK is
//	(vehicle_id, ts, event_type); the id column added in mig 000189
//	is a sequence-backed surrogate so the REST URL
//	/guard/events/{event_id}/acknowledge can address a single row.
//
//	`sentry_mode_active` is computed from the latest security_events
//	row with event_type='sentry_mode' for the vehicle. The escape hatch
//	in the prompt explicitly authorises this when SentryMode is routed
//	to security_event (which it is — see internal/tesla/router/routing.yaml
//	line 799). The to_state column carries the proto-enum String(),
//	e.g. "SentryModeStateOff", "SentryModeStateArmed", etc. (see
//	internal/tesla/protomodel/enum_parsers_gen.go:1753-1771). Anything
//	other than Off/Unknown counts as active — Idle, Armed, Aware,
//	Panic, Quiet all mean Sentry is enabled even when not currently
//	alarming.
package system

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GuardEvent is one row in the /guard/events response. Snake-case JSON
// tags so the frontend hooks read the same shape regardless of whether
// camelCaseKeys is applied client-side.
//
// AcknowledgedAt + AcknowledgedBy are pointer-nullable so an
// unacknowledged event renders JSON `null` rather than `""` / epoch
// zero — the frontend's `acknowledged: boolean` derives from
// `acknowledged_at != null`.
type GuardEvent struct {
	ID             int64          `json:"id"`
	VehicleID      int64          `json:"vehicle_id"`
	TS             time.Time      `json:"ts"`
	EventType      string         `json:"event_type"`
	FromState      *string        `json:"from_state"`
	ToState        *string        `json:"to_state"`
	Details        map[string]any `json:"details"`
	AcknowledgedAt *time.Time     `json:"acknowledged_at"`
	AcknowledgedBy *string        `json:"acknowledged_by"`
}

// GuardStatus is the /vehicles/{id}/guard response shape per Decision #1.
//
// LastState + LastStateAt are nullable to disambiguate "vehicle has
// never reported sentry state" from "Sentry is currently off". The
// frontend renders an explicit "no data" state for nil LastStateAt,
// per the project-wide null-safety rules in `.github/instructions`.
type GuardStatus struct {
	VehicleID           int64      `json:"vehicle_id"`
	SentryModeActive    bool       `json:"sentry_mode_active"`
	LastState           *string    `json:"last_state"`
	LastStateAt         *time.Time `json:"last_state_at"`
	RecentEventCount24h int        `json:"recent_event_count_24h"`
}

// guardPool is the minimal pgxpool subset GuardRepo needs. Declared
// locally so handler tests can supply a fake without dragging in
// pgxmock (the codebase does not vendor pgxmock — see repo memories).
type guardPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// GuardRepo serves the four /guard endpoints. Construct via NewGuardRepo.
type GuardRepo struct {
	pool guardPool
}

// NewGuardRepo binds the repo to a pgx pool. Mirrors the snapshot-writer
// fail-fast precedent — a nil pool at construction is a wiring bug, not
// a runtime condition.
func NewGuardRepo(pool *pgxpool.Pool) *GuardRepo {
	if pool == nil {
		panic("database.NewGuardRepo: pool must not be nil")
	}
	return &GuardRepo{pool: pool}
}

// SentryModeStateOff + SentryModeStateUnknown are the proto-enum
// String() outputs that mean "Sentry is NOT armed/enabled". Every
// other state — Idle, Armed, Aware, Panic, Quiet — means Sentry is
// enabled even when not actively alarming, and counts as active for
// the dashboard indicator. Sourced from
// internal/tesla/protomodel/enum_parsers_gen.go:1753-1771; mirroring
// them as untyped string constants here keeps GuardRepo dependency-
// free of the protomodel package and stable across regenerations of
// the proto bindings.
const (
	sentryModeOffToken     = "SentryModeStateOff"
	sentryModeUnknownToken = "SentryModeStateUnknown"
	// sentryEventType is the writer's token for SentryMode rows
	// (internal/tesla/router/writers/security_event_writer.go:46).
	sentryEventType = "sentry_mode"
)

// guardVehicleExistsSQL probes the vehicles row for a 404-vs-200-empty
// disambiguation. Mirrors vehicle_states_repo.go / mileage_repo.go /
// vampire_drain_repo.go (security_events has no FK on vehicle_id —
// dangling rows for a deleted vehicle would otherwise produce 200 with
// stale data).
const guardVehicleExistsSQL = `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`

// VehicleExists reports whether a row exists in the vehicles table for
// vehicleID.
func (r *GuardRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, guardVehicleExistsSQL, vehicleID).Scan(&exists); err != nil {
		return false, fmt.Errorf("guard: probe vehicle existence: %w", err)
	}
	return exists, nil
}

// guardLatestSentrySQL returns the latest sentry_mode transition for a
// vehicle. (vehicle_id, event_type, ts) is covered by the existing
// security_events_event_type index (mig 000183 line 212) — the hot
// path is a single index seek + LIMIT 1.
const guardLatestSentrySQL = `
SELECT ts, to_state
FROM security_events
WHERE vehicle_id = $1
  AND event_type = $2
ORDER BY ts DESC
LIMIT 1
`

// guardEventCount24hSQL counts ALL security events (any event_type) in
// the last 24 hours for a vehicle. The frontend dashboard uses this as
// a "you have N recent guard signals to review" indicator; scoping to
// only sentry_mode would under-count panic alerts, lock state changes,
// and other security-relevant transitions.
const guardEventCount24hSQL = `
SELECT COUNT(*)
FROM security_events
WHERE vehicle_id = $1
  AND ts >= $2
`

// Status returns the /vehicles/{id}/guard response for vehicleID.
// `now` is injected so the handler's clock can be pinned in tests; the
// 24h boundary is computed from it once per call so the SQL row-filter
// timestamp is the same value the response is computed against.
func (r *GuardRepo) Status(ctx context.Context, vehicleID int64, now time.Time) (GuardStatus, error) {
	out := GuardStatus{VehicleID: vehicleID}

	// Latest sentry_mode row drives both LastState/LastStateAt and
	// SentryModeActive. We tolerate "no rows" (a brand-new vehicle
	// that has not yet reported sentry state) by leaving LastState
	// nil + SentryModeActive=false rather than erroring out.
	var ts time.Time
	var toState *string
	err := r.pool.QueryRow(ctx, guardLatestSentrySQL, vehicleID, sentryEventType).Scan(&ts, &toState)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// no-op: leave LastState/LastStateAt nil, SentryModeActive=false.
	case err != nil:
		return GuardStatus{}, fmt.Errorf("guard.status: latest sentry: %w", err)
	default:
		out.LastStateAt = &ts
		out.LastState = toState
		if toState != nil && *toState != sentryModeOffToken && *toState != sentryModeUnknownToken && *toState != "" {
			out.SentryModeActive = true
		}
	}

	// 24h event count. windowStart cuts both sides so the value is
	// monotonically the same for a fixed `now`.
	windowStart := now.Add(-24 * time.Hour)
	var count int
	if err := r.pool.QueryRow(ctx, guardEventCount24hSQL, vehicleID, windowStart).Scan(&count); err != nil {
		return GuardStatus{}, fmt.Errorf("guard.status: 24h event count: %w", err)
	}
	out.RecentEventCount24h = count

	return out, nil
}

// guardListEventsSQL returns the most-recent N security events for a
// vehicle, including the acknowledgement columns. Ordered DESC by ts
// (then id as a tiebreaker for two events at the same ts) so the
// frontend's pagination matches its "newest first" rendering. The
// (vehicle_id, ts DESC) index from mig 000183 line 211 covers the
// ORDER BY without a sort.
const guardListEventsSQL = `
SELECT id, vehicle_id, ts, event_type, from_state, to_state, details,
       acknowledged_at, acknowledged_by
FROM security_events
WHERE vehicle_id = $1
ORDER BY ts DESC, id DESC
LIMIT $2
`

// Events returns guard events for vehicleID, capped at limit rows.
// Caller must validate limit > 0 (the SQL uses LIMIT $2 directly).
func (r *GuardRepo) Events(ctx context.Context, vehicleID int64, limit int) ([]GuardEvent, error) {
	rows, err := r.pool.Query(ctx, guardListEventsSQL, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("guard.events: query: %w", err)
	}
	defer rows.Close()

	out := make([]GuardEvent, 0)
	for rows.Next() {
		ev, err := scanGuardEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("guard.events: scan: %w", err)
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("guard.events: rows iter: %w", err)
	}
	return out, nil
}

// guardAcknowledgeSQL implements Decision #3 verbatim:
//
//	UPDATE ... SET acknowledged_at = now(), acknowledged_by = $3
//	WHERE id = $1 AND vehicle_id = $2
//
// The vehicle_id filter prevents cross-vehicle acknowledgement
// attempts: a request for vehicle 7 trying to ack event-id-belonging-
// to-vehicle-3 returns RowsAffected==0 and is reported as 404 by the
// handler.
//
// RETURNING fetches the updated row in the same round-trip so the
// handler can echo the new state back without a follow-up SELECT.
//
// Re-acknowledgement overwrites acknowledged_at/_by (the prompt's
// literal SQL is `SET acknowledged_at = now()`, not COALESCE). This
// preserves an audit trail of who most recently acknowledged in
// systems with multiple operators.
const guardAcknowledgeSQL = `
UPDATE security_events
SET acknowledged_at = now(),
    acknowledged_by = $3
WHERE id = $1
  AND vehicle_id = $2
RETURNING id, vehicle_id, ts, event_type, from_state, to_state, details,
          acknowledged_at, acknowledged_by
`

// ErrGuardEventNotFound is returned by Acknowledge when no row matches
// (id, vehicle_id) — either the id does not exist, or it belongs to a
// different vehicle. Same sentinel for both cases on purpose: leaking
// "this id exists but for another vehicle" would be an authorisation
// side-channel.
var ErrGuardEventNotFound = errors.New("guard event not found")

// Acknowledge marks the (id, vehicle_id) event as acknowledged by
// `actor` (which may be empty in open-mode installs — actorFromRequest
// returns "" when no ForwardAuth header is configured, and we treat
// that as a valid identity per the quiet_hours_handler precedent).
//
// Returns ErrGuardEventNotFound when no row was updated. Other errors
// are wrapped with the operation context.
func (r *GuardRepo) Acknowledge(ctx context.Context, vehicleID, eventID int64, actor string) (GuardEvent, error) {
	row := r.pool.QueryRow(ctx, guardAcknowledgeSQL, eventID, vehicleID, actor)
	ev, err := scanGuardEvent(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return GuardEvent{}, ErrGuardEventNotFound
	}
	if err != nil {
		return GuardEvent{}, fmt.Errorf("guard.acknowledge: %w", err)
	}
	return ev, nil
}

// scanGuardEvent decodes one row in the GuardEvent column order shared
// by guardListEventsSQL and guardAcknowledgeSQL. Centralised so the
// two paths cannot drift out of sync — adding a column to the SELECT
// list requires updating exactly one Scan call.
//
// The accepted scanner interface (pgx.Row + pgx.Rows both implement
// Scan(...) error) lets the same helper feed both QueryRow and Query
// loops without an adapter layer.
type pgxScanner interface {
	Scan(dest ...any) error
}

func scanGuardEvent(s pgxScanner) (GuardEvent, error) {
	var ev GuardEvent
	var details []byte
	if err := s.Scan(
		&ev.ID,
		&ev.VehicleID,
		&ev.TS,
		&ev.EventType,
		&ev.FromState,
		&ev.ToState,
		&details,
		&ev.AcknowledgedAt,
		&ev.AcknowledgedBy,
	); err != nil {
		return GuardEvent{}, err
	}
	if len(details) > 0 {
		ev.Details = decodeGuardDetails(details)
	}
	return ev, nil
}

// decodeGuardDetails parses the JSONB details blob into a generic map.
// On any decode failure we return nil + log the error at the handler
// boundary; the row itself is still useful even if its structured
// context is malformed (e.g. a producer-side schema bug).
func decodeGuardDetails(raw []byte) map[string]any {
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}
