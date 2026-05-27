package unithistory

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// unitHistoryTracerName is the OpenTelemetry tracer name for spans
// emitted by Repo.Record. The Phase-10 trace-coverage audit greps for
// this exact constant.
const unitHistoryTracerName = "tesla.unit_history"

// Repo is the unit-history persistence contract. It is an interface so
// callers can substitute a fake in unit tests (see repo_test.go's
// memRepo) without spinning up a Postgres container, and so the
// production wiring can swap implementations (e.g. a future read-replica
// router) without rewriting every consumer.
//
// The two reader methods are split because they have different cache
// semantics: At(t) is a point-in-time query that may legitimately need
// to bypass the cache (for backfill / replay / "what was the unit at
// 09:15?" queries), whereas Latest is the hot path that the normalize
// pipeline calls once per Atomic and that benefits most from caching.
type Repo interface {
	// Record inserts a new unit-history row. The implementation is
	// idempotent on (vehicle_id, unit_kind, effective_from, unit_value,
	// source) — re-running the bootstrap or replaying the same MQTT
	// payload writes zero rows the second time. After a successful
	// PostgreSQL commit the implementation invalidates the cache for
	// (e.VehicleID, e.Kind); a Redis DEL failure is logged + counted
	// but does NOT propagate as an error because the 60s TTL bounds
	// the inconsistency window.
	Record(ctx context.Context, e Entry) error

	// At returns the wire-format unit that was active for the vehicle
	// at instant t — i.e. the row with the largest effective_from <= t.
	// Ties at the same effective_from are broken by id DESC so the
	// answer is deterministic across pods. Returns ErrNotFound if no
	// such row exists; the caller (normalize pipeline) drops the
	// sample and bumps a counter rather than guessing a default unit.
	At(ctx context.Context, vehicleID int64, kind Kind, t time.Time) (units.ActiveUnit, error)

	// Latest returns the most recent Entry for the vehicle/kind. It is
	// the equivalent of At(now) but returns the full Entry (including
	// effective_from + source) so callers can render "active since…"
	// metadata. Returns ErrNotFound if the vehicle has never had a
	// Setting*Unit row recorded for the kind.
	Latest(ctx context.Context, vehicleID int64, kind Kind) (Entry, error)
}

// dbtx is the read+write surface pgRepo needs from pgxpool.Pool / pgx.Tx.
// Mirrors internal/database.DBTX so tests can swap in a recording fake
// without depending on the production database package.
type dbtx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// pgRepo is the production Repo backed by a pgxpool.Pool plus an
// optional Cache. The cache is required in production wiring (see
// cmd/teslasync wiring) but the repo will operate with cache=nil in
// tests and degraded modes — every read falls through to PG and every
// write skips the cache-invalidate step.
type pgRepo struct {
	db    dbtx
	cache *Cache
}

// NewRepo constructs the production Repo. cache may be nil — see pgRepo
// for the degraded-mode semantics.
func NewRepo(db dbtx, cache *Cache) Repo {
	return &pgRepo{db: db, cache: cache}
}

// recordSQL is the INSERT statement Repo.Record runs. The ON CONFLICT
// DO NOTHING path makes Record idempotent on the natural key — re-runs
// of the REST bootstrap or MQTT replay write zero rows the second time
// and the cache-invalidate still fires (the next read will repopulate
// from PG and observe the same state, which is correct).
const recordSQL = `
INSERT INTO vehicle_unit_history (vehicle_id, unit_kind, unit_value, effective_from, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (vehicle_id, unit_kind, effective_from, unit_value, source) DO NOTHING
`

// atSQL is the lookup query for Repo.At. The composite ORDER BY
// effective_from DESC, id DESC is the deterministic-tiebreaker contract:
// without ORDER BY id DESC, two rows inserted at the same effective_from
// (e.g. bootstrap at process start vs the first telemetry packet
// arriving in the same second) could resolve differently across pods.
// The PRIMARY KEY index on (vehicle_id, unit_kind, effective_from, id)
// — declared by the migration — makes this an index-only scan with a
// LIMIT 1 fast path.
const atSQL = `
SELECT unit_value
FROM vehicle_unit_history
WHERE vehicle_id = $1 AND unit_kind = $2 AND effective_from <= $3
ORDER BY effective_from DESC, id DESC
LIMIT 1
`

// latestSQL returns the full latest Entry. Sharing the ordering rule
// with atSQL guarantees Latest and At(now()) agree on the same row.
const latestSQL = `
SELECT unit_value, effective_from, source
FROM vehicle_unit_history
WHERE vehicle_id = $1 AND unit_kind = $2
ORDER BY effective_from DESC, id DESC
LIMIT 1
`

func (r *pgRepo) Record(ctx context.Context, e Entry) (err error) {
	ctx, span := otel.Tracer(unitHistoryTracerName).Start(
		ctx,
		"unit_history.record",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", e.VehicleID),
			attribute.String("unit_kind", string(e.Kind)),
			attribute.String("unit", string(e.Value)),
			attribute.String("source", string(e.Source)),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "unit_history.record")
		}
		span.End()
	}()

	if e.VehicleID == 0 {
		return fmt.Errorf("unit_history: Record: vehicle_id is zero")
	}
	if e.Kind == "" {
		return fmt.Errorf("unit_history: Record: kind is empty")
	}
	if e.Value == "" {
		return fmt.Errorf("unit_history: Record: value is empty")
	}
	if e.Source == "" {
		return fmt.Errorf("unit_history: Record: source is empty")
	}
	if e.EffectiveFrom.IsZero() {
		return fmt.Errorf("unit_history: Record: effective_from is zero")
	}

	// Normalize timestamp to UTC so callers that pass a Local-zoned
	// time do not get a row with a non-UTC TIMESTAMPTZ that pgx will
	// then byte-compare differently in subsequent ON CONFLICT checks.
	// PostgreSQL stores TIMESTAMPTZ in UTC internally so this is a
	// pre-write canonicalization, not a behavioral change.
	effFrom := e.EffectiveFrom.UTC()

	tag, err := r.db.Exec(ctx, recordSQL,
		e.VehicleID, string(e.Kind), string(e.Value), effFrom, string(e.Source),
	)
	if err != nil {
		return fmt.Errorf("unit_history: Record: %w", err)
	}
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()))

	// Cache-invalidate AFTER the PG commit per the cross-pod contract.
	// A nil cache (degraded / test mode) is a no-op. A Redis DEL failure
	// is logged + counted via invalidateFailuresTotal but never
	// returned: the 60s TTL bounds the inconsistency window and a
	// blocking Redis would otherwise stall MQTT ingest.
	if r.cache != nil {
		r.cache.Invalidate(ctx, e.VehicleID, e.Kind)
	}
	return nil
}

func (r *pgRepo) At(ctx context.Context, vehicleID int64, kind Kind, t time.Time) (units.ActiveUnit, error) {
	if vehicleID == 0 {
		return "", fmt.Errorf("unit_history: At: vehicle_id is zero")
	}
	if kind == "" {
		return "", fmt.Errorf("unit_history: At: kind is empty")
	}

	// Cache fast path. The validity rule (cached entry valid for
	// requested t only when t >= cached.EffectiveFrom) lives inside
	// Cache.GetForAt; here we simply ask whether the cache can answer
	// for the requested t and trust its decision.
	if r.cache != nil {
		if entry, ok := r.cache.GetForAt(ctx, vehicleID, kind, t); ok {
			return entry.Value, nil
		}
	}

	row := r.db.QueryRow(ctx, atSQL, vehicleID, string(kind), t.UTC())
	var raw string
	switch err := row.Scan(&raw); {
	case errors.Is(err, pgx.ErrNoRows):
		return "", ErrNotFound
	case err != nil:
		return "", fmt.Errorf("unit_history: At: %w", err)
	}
	return units.ActiveUnit(raw), nil
}

func (r *pgRepo) Latest(ctx context.Context, vehicleID int64, kind Kind) (Entry, error) {
	if vehicleID == 0 {
		return Entry{}, fmt.Errorf("unit_history: Latest: vehicle_id is zero")
	}
	if kind == "" {
		return Entry{}, fmt.Errorf("unit_history: Latest: kind is empty")
	}

	// Cache fast path: Latest IS the cache's natural answer (the
	// cached row IS the latest known row), so a hit returns directly
	// without the t-comparison At needs.
	if r.cache != nil {
		if entry, ok := r.cache.GetLatest(ctx, vehicleID, kind); ok {
			return entry, nil
		}
	}

	row := r.db.QueryRow(ctx, latestSQL, vehicleID, string(kind))
	var (
		raw     string
		effFrom time.Time
		src     string
	)
	switch err := row.Scan(&raw, &effFrom, &src); {
	case errors.Is(err, pgx.ErrNoRows):
		return Entry{}, ErrNotFound
	case err != nil:
		return Entry{}, fmt.Errorf("unit_history: Latest: %w", err)
	}

	entry := Entry{
		VehicleID:     vehicleID,
		Kind:          kind,
		Value:         units.ActiveUnit(raw),
		EffectiveFrom: effFrom,
		Source:        Source(src),
	}

	// On a PG read that successfully returned the latest row, populate
	// the cache so subsequent reads hit the hot path. A nil cache is
	// a no-op; a PutLatest failure is logged but never returned.
	if r.cache != nil {
		r.cache.PutLatest(ctx, entry)
	}
	return entry, nil
}
