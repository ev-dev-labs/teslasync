package fsd

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// signalLogQuerier is the minimal pgx surface Repo needs. Declaring it as an
// interface (rather than binding to *pgxpool.Pool) lets the scan/iterate
// logic be unit-tested with an in-package fake — this codebase does not
// vendor pgxmock. It mirrors the tempimpact / sleep repo precedent.
type signalLogQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// windowSamplesSQL reads every in-window observation of the requested
// counters in one pass.
//
// Index alignment: signal_log carries
// `signal_log_vehicle_field_ts (vehicle_id, field, ts DESC)` (mig 000186,
// re-asserted by mig 000215). `vehicle_id = $1 AND field = ANY($2)` with a
// bounded `ts` range is a per-field index range scan.
//
// Deliberately NO `ORDER BY`. The index is DESC on `ts`, so an ascending
// ORDER BY would ask the planner for an ordering the index does not provide
// in that direction and add a sort node for rows that Aggregate re-sorts
// anyway (`accumulate` stable-sorts each field's samples by timestamp before
// differencing, and must, because the baseline and window result sets are
// concatenated). Paying for a database sort whose result is then discarded is
// pure cost.
//
// COALESCE(float_value, int_value::float8) mirrors the canonical projection
// used by database/signal.SignalTrace: SelfDrivingMilesSinceReset is
// ValueKindFloat, but coercing an int-kind row rather than dropping it keeps
// the read resilient to a future kind change without a code change.
const windowSamplesSQL = `
	SELECT field, ts, COALESCE(float_value, int_value::float8) AS value,
	       normalization_version
	FROM signal_log
	WHERE vehicle_id = $1
	  AND field = ANY($2)
	  AND ts >= $3
	  AND ts < $4`

// baselineSamplesSQL reads exactly ONE observation per counter from strictly
// before the window.
//
// A trusted, valid row makes the first in-window observation attributable: a
// cumulative counter only tells you distance when you can difference it
// against an earlier reading. The newest raw row must be returned even when
// its provenance or value is invalid, because such a row is a continuity
// barrier; silently reaching past it to an older trusted row can fabricate a
// delta. DISTINCT ON (field) ... ORDER BY field, ts DESC is a backwards scan per field on
// signal_log_vehicle_field_ts, so the cost is O(log n) per counter regardless
// of how far back the last emission was. Unlike the window read, the ORDER BY
// here is REQUIRED — it is what DISTINCT ON selects the row by, and it runs in
// the index's native direction.
const baselineSamplesSQL = `
	SELECT DISTINCT ON (field) field, ts,
	       COALESCE(float_value, int_value::float8) AS value,
	       normalization_version
	FROM signal_log
	WHERE vehicle_id = $1
	  AND field = ANY($2)
	  AND ts < $3
	ORDER BY field, ts DESC`

// Repo is the production signal_log reader for FSD Insights.
//
// It performs CHANGE-FEED reads only (raw ordered events), which is the
// ADR-002 surface that owns this shape. Point-in-time state reads belong
// behind signal.StateReader and are deliberately not used here.
//
// Deadline ownership: repo methods do NOT mint their own timeouts. One
// request serves one dashboard panel, so the handler establishes a SINGLE
// budget covering both reads and passes that context down (see
// Handler.Insights). A per-method timeout would silently double the
// worst-case latency and let the second query start a fresh budget after the
// first had already burned the request's time.
type Repo struct {
	pool signalLogQuerier
}

// NewRepo binds the repo to the shared pool. A nil pool is a wiring bug
// rather than a runtime state, matching the newDBTempImpactRepo precedent.
func NewRepo(db *database.DB) *Repo {
	if db == nil || db.Pool == nil {
		panic("fsd.NewRepo: db pool must not be nil")
	}
	return &Repo{pool: db.Pool}
}

// WindowSamples returns every observation of `fields` inside [from, to).
//
// Row order is unspecified; Aggregate sorts by timestamp per field.
// `ctx` carries the caller's deadline — this method adds none of its own.
func (r *Repo) WindowSamples(ctx context.Context, vehicleID int64, fields []string, from, to time.Time) ([]Sample, error) {
	rows, err := r.pool.Query(ctx, windowSamplesSQL, vehicleID, fields, from, to)
	if err != nil {
		return nil, fmt.Errorf("query fsd window samples for vehicle %d: %w", vehicleID, err)
	}
	return scanSamples(rows, "fsd window sample")
}

// BaselineSamples returns at most one observation per field, the newest one
// strictly before `before`.
//
// `ctx` carries the caller's deadline — this method adds none of its own.
func (r *Repo) BaselineSamples(ctx context.Context, vehicleID int64, fields []string, before time.Time) ([]Sample, error) {
	rows, err := r.pool.Query(
		ctx,
		baselineSamplesSQL,
		vehicleID,
		fields,
		before,
	)
	if err != nil {
		return nil, fmt.Errorf("query fsd baseline samples for vehicle %d: %w", vehicleID, err)
	}
	return scanSamples(rows, "fsd baseline sample")
}

// scanSamples drains a sample result set. A scan failure fails the whole call
// — these rows ARE the payload, so silently dropping one would understate
// distance without anything in the response saying so.
func scanSamples(rows pgx.Rows, what string) ([]Sample, error) {
	defer rows.Close()

	out := make([]Sample, 0)
	for rows.Next() {
		var s Sample
		if err := rows.Scan(&s.Field, &s.TS, &s.Value, &s.NormalizationVersion); err != nil {
			return nil, fmt.Errorf("scan %s row: %w", what, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s rows: %w", what, err)
	}
	return out, nil
}
