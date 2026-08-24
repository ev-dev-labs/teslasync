package user

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/jackc/pgx/v5"
)

// OnboardingState is the durable "is this install configured" marker.
// It is intentionally decoupled from OnboardingStatus (the live,
// runtime-computed anchors): once Completed flips true it stays true
// forever, regardless of subsequent Tesla token expiry or Fleet
// Telemetry staleness. See the package doc on
// [internal/api/onboarding.Handler] for the full contract.
type OnboardingState struct {
	// Completed is true once the live three-anchor check (tesla
	// connected, at least one vehicle, telemetry flowing) was observed
	// true at least once, OR the row was backfilled by migration
	// 000230 for an already-configured pre-existing installation.
	Completed bool
	// CompletedAt is the timestamp of the first observed completion.
	// Nil until Completed is true.
	CompletedAt *time.Time
}

// OnboardingStateRepo persists [OnboardingState]. It mirrors the
// single-row (id=1) pattern used by internal/database/system's
// SystemStateRepo — every accessor targets that one row so callers
// never have to think about which row to touch.
type OnboardingStateRepo struct {
	db *database.DB
}

// NewOnboardingStateRepo wires the repo to the shared pgx pool.
func NewOnboardingStateRepo(db *database.DB) *OnboardingStateRepo {
	return &OnboardingStateRepo{db: db}
}

// Get reads the durable completion marker. A missing row is reported as
// OnboardingState{Completed:false}; a missing repository dependency is an
// explicit error rather than a success-shaped "fresh install" response.
func (r *OnboardingStateRepo) Get(ctx context.Context) (OnboardingState, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return OnboardingState{}, errors.New("onboarding state repository is not configured")
	}
	var s OnboardingState
	err := r.db.Pool.QueryRow(ctx,
		`SELECT setup_completed, setup_completed_at FROM onboarding_state WHERE id = 1`,
	).Scan(&s.Completed, &s.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OnboardingState{}, nil
	}
	if err != nil {
		return OnboardingState{}, fmt.Errorf("onboarding_state get: %w", err)
	}
	return s, nil
}

// MarkComplete durably flips setup_completed to true. It is a ratchet
// by design: there is no corresponding "unmark" method. Once true,
// repeated calls are idempotent no-ops that preserve the original
// setup_completed_at (COALESCE keeps the first-observed timestamp),
// so callers can call this unconditionally every time the live
// three-anchor check passes without worrying about clobbering history
// or needing to gate the call themselves.
func (r *OnboardingStateRepo) MarkComplete(ctx context.Context) (OnboardingState, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return OnboardingState{}, errors.New("onboarding state repository is not configured")
	}
	var s OnboardingState
	err := r.db.Pool.QueryRow(ctx,
		`INSERT INTO onboarding_state (id, setup_completed, setup_completed_at, updated_at)
		 VALUES (1, true, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET
		   setup_completed    = true,
		   setup_completed_at = COALESCE(onboarding_state.setup_completed_at, EXCLUDED.setup_completed_at),
		   updated_at         = NOW()
		 RETURNING setup_completed, setup_completed_at`,
	).Scan(&s.Completed, &s.CompletedAt)
	if err != nil {
		return OnboardingState{}, fmt.Errorf("onboarding_state mark_complete: %w", err)
	}
	return s, nil
}
