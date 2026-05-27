package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Event is the canonical write shape Append takes. It mirrors the
// fields of internal/events.Event so producers can wrap one without
// re-marshalling.
type Event struct {
	Type      string
	VehicleID int64
	VIN       string
	Payload   any
	Headers   map[string]string
	TraceID   string
}

// Status enumerates the row lifecycle in events_outbox.
type Status string

const (
	StatusPending   Status = "pending"
	StatusInFlight  Status = "in_flight"
	StatusPublished Status = "published"
	StatusFailed    Status = "failed"
	StatusDiscarded Status = "discarded"
)

// ErrNoPool is returned when Store methods are called with a nil
// receiver or a Store whose pool is nil. Surfacing a typed error
// (rather than a panic) keeps the API tractable for callers that
// optionally wire the outbox.
var ErrNoPool = errors.New("outbox: store has no pgx pool (wiring bug)")

// Writer is the narrow write surface the outbox needs from a
// transaction or pool. Satisfied by both pgx.Tx and *pgxpool.Pool.
type Writer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store provides Append + the operational methods the dispatcher uses.
// Construct via NewStore so the zero value is intentionally non-functional.
type Store struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewStore wires a Store around the given pool. A nil pool yields a
// nil Store so callers can `if s != nil` defend against degraded
// startup paths that lack a database.
func NewStore(pool *pgxpool.Pool) *Store {
	if pool == nil {
		return nil
	}
	return &Store{pool: pool, now: time.Now}
}

// Append inserts ONE event into events_outbox. The caller passes a
// Writer which is typically a pgx.Tx so the outbox row is committed
// atomically with the domain mutation. Passing nil falls back to the
// pool — supported for fire-and-forget callers that do not need
// transactional atomicity.
//
// Returns the inserted row id so the caller can correlate with the
// dispatcher's published_at via /admin/outbox/{id}.
func (s *Store) Append(ctx context.Context, w Writer, ev Event) (int64, error) {
	if s == nil || s.pool == nil {
		return 0, ErrNoPool
	}
	if ev.Type == "" {
		return 0, errors.New("outbox: event.Type is required")
	}
	if w == nil {
		w = s.pool
	}

	payloadBytes, err := json.Marshal(ev.Payload)
	if err != nil {
		return 0, fmt.Errorf("outbox: marshal payload: %w", err)
	}

	var headersBytes []byte
	if len(ev.Headers) > 0 {
		headersBytes, err = json.Marshal(ev.Headers)
		if err != nil {
			return 0, fmt.Errorf("outbox: marshal headers: %w", err)
		}
	}

	now := s.now().UTC()
	var vehicleID any
	if ev.VehicleID > 0 {
		vehicleID = ev.VehicleID
	}
	var vin any
	if ev.VIN != "" {
		vin = ev.VIN
	}
	var traceID any
	if ev.TraceID != "" {
		traceID = ev.TraceID
	}

	const insert = `
INSERT INTO events_outbox (
    created_at, event_type, vehicle_id, vin, payload, headers,
    status, attempts, next_attempt_at, trace_id
) VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $1, $7)
RETURNING id`

	var id int64
	err = w.QueryRow(ctx, insert,
		now, ev.Type, vehicleID, vin, payloadBytes, nullableJSON(headersBytes),
		traceID).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("outbox: insert: %w", err)
	}
	return id, nil
}

// Pool exposes the underlying pgxpool for the dispatcher; not for
// general callers. Returns nil for nil Store.
func (s *Store) Pool() *pgxpool.Pool {
	if s == nil {
		return nil
	}
	return s.pool
}

func nullableJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
