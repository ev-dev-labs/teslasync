package user

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/jackc/pgx/v5"
)

// OnboardingRepo provides the read-only data access used by the
// first-run onboarding gate.
//
// It deliberately exposes a single struct that bundles the two pieces
// of state the handler can derive from the database — the count of
// vehicles registered in the local fleet and a freshness signal for
// telemetry — so the handler can resolve the entire onboarding status
// in one round-trip per dependency without leaking SQL into the API
// layer.
type OnboardingRepo struct {
	db *database.DB
}

// NewOnboardingRepo wires the repo to the shared pgx pool.
func NewOnboardingRepo(db *database.DB) *OnboardingRepo {
	return &OnboardingRepo{db: db}
}

// OnboardingStatus is the database-derived portion of the onboarding
// state returned to clients. Tesla account connectivity is computed
// outside this repo (TokenRepo.Get) and combined in the handler.
type OnboardingStatus struct {
	// VehicleCount is the number of rows in the `vehicles` table.
	VehicleCount int
	// DataFlowing is true when at least one row has been written to
	// `signal_log` within the last 24 hours.
	DataFlowing bool
	// LastSignalAt is the most recent signal_log timestamp across every
	// vehicle, or nil if no signal has ever been recorded. Populated by
	// the same Get() call (via LastSignalAt) so callers get a single
	// round-trip bundle of "is data flowing right now" (DataFlowing,
	// bounded to a 24h window — cheap/sargable) plus the exact instant
	// for display and for the runtime health watchdog's own (shorter,
	// conservative) staleness threshold. See internal/app's health
	// watchdog telemetry component check for that separate consumer.
	LastSignalAt *time.Time
}

// Get returns the current onboarding status. It runs two cheap
// queries:
//
//  1. count(*) on `vehicles`
//  2. EXISTS(...) over `signal_log` constrained to the last 24 hours
//     — the constraint is critical because `signal_log` is a
//     TimescaleDB hypertable and an unbounded scan would touch every
//     chunk.
//  3. LastSignalAt() — an indexed ORDER BY ts DESC LIMIT 1, so
//     "no rows in 24h" and "exact last-seen instant" are both cheap.
//
// Errors from either query are wrapped with context so the caller can
// distinguish which dependency failed.
func (r *OnboardingRepo) Get(ctx context.Context) (*OnboardingStatus, error) {
	var status OnboardingStatus

	if err := r.db.Pool.QueryRow(ctx,
		`SELECT count(*)::int FROM vehicles`,
	).Scan(&status.VehicleCount); err != nil {
		return nil, fmt.Errorf("count vehicles: %w", err)
	}

	// Use a bounded EXISTS check so the planner can stop after the
	// first matching row in the most-recent chunk. NOW() - INTERVAL
	// '24 hours' is sargable against the hypertable's time-partitioned
	// index on created_at.
	var dataFlowing bool
	err := r.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM signal_log
			WHERE ts > NOW() - INTERVAL '24 hours'
			LIMIT 1
		)`,
	).Scan(&dataFlowing)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("check signal_log freshness: %w", err)
	}
	status.DataFlowing = dataFlowing

	lastSignalAt, err := r.LastSignalAt(ctx)
	if err != nil {
		return nil, fmt.Errorf("last signal timestamp: %w", err)
	}
	status.LastSignalAt = lastSignalAt

	return &status, nil
}

// LastSignalAt returns the most recent signal_log timestamp seen
// across all vehicles, or nil if no signals have ever been recorded.
// It scans only the most recent hypertable chunk thanks to the
// ORDER BY DESC + LIMIT 1 pattern; callers should use this only when
// they need the timestamp itself (for diagnostics) — Get() is
// preferred for the boolean freshness check.
func (r *OnboardingRepo) LastSignalAt(ctx context.Context) (*time.Time, error) {
	var ts time.Time
	err := r.db.Pool.QueryRow(ctx,
		`SELECT ts FROM signal_log ORDER BY ts DESC LIMIT 1`,
	).Scan(&ts)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("max signal_log timestamp: %w", err)
	}
	return &ts, nil
}
