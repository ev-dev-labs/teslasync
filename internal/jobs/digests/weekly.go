package digests

// Phase-50 / 0012 — U2 Weekly digest narration.
//
// ai_digest_weekly.go is the cross-cutting cron stub that the
// digest-narration slice registers as its background-job surface
// (`ai_digest_weekly` in the features registry's PushKinds list).
//
// The stub is fail-closed by design: every tick re-reads the
// settings table and refuses to do anything when ai_mode is off OR
// the per-feature toggle is off (ADR-015 §I12 #3 — "background
// dispatcher gate trips before execution"). The real fan-out
// implementation will land alongside the push-delivery slice; this
// file ships the gate + telemetry envelope so the off-mode invariant
// is provable today.
//
// The function is exported so a future scheduler (cmd/scheduler or
// the existing internal/worker pool) can install it on a once-per-
// week cron without further plumbing changes.

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// WeeklySettingsReader is the narrow view of
// [settingsdb.SettingsRepo] [RunWeekly] depends on. Defined
// inline so callers can supply a fake without dragging the full
// settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin who
// disables digest-narration mid-week sees the next run no-op
// immediately (no waiting for the worker pool to recycle).
type WeeklySettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// WeeklyResult reports the outcome of one tick. The fields
// are all int because the real fan-out implementation will tally
// per-vehicle narrations + push deliveries here; today the values
// stay zero (the stub is a no-op when off, and a no-op-with-log
// when on — narration generation lands in a future slice).
type WeeklyResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode was
	// off OR the per-feature toggle was off. Reported separately
	// from "no work to do" so the ops dashboard can distinguish a
	// degraded settings table from an idle week.
	Skipped int

	// VehiclesConsidered is the number of vehicles the tick fanned
	// out a narration request for. Always 0 in this slice (the
	// fan-out implementation lands in a future slice); the field
	// is in the envelope so callers can pin the shape today.
	VehiclesConsidered int

	// Narrated is the number of vehicles whose narration was
	// successfully produced. Always 0 in this slice.
	Narrated int

	// Failed is the number of vehicles whose narration failed.
	// Always 0 in this slice.
	Failed int
}

// RunWeekly is the once-per-week cron entry for the
// digest-narration slice's background fan-out.
//
// Re-checks ai_mode + the per-feature toggle at execution time per
// ADR-015 §I12 #3 — the scheduler may have started this loop while
// AI was on, but the admin can flip ai_mode='off' OR disable the
// toggle at any moment and we MUST honour it immediately. If either
// gate is off the function returns ([WeeklyResult{Skipped:
// 1}], nil) without touching the LLM, the tools, or the push fan-out.
//
// Settings read failures are LOGGED WARN and treated as off (no
// fan-out). Fail-closed semantics: a degraded settings table must
// not silently leak narrations to off-mode users.
//
// The current implementation is deliberately a no-op gate. The
// per-vehicle narration loop, the push-fanout, and the telemetry
// counters land in the push-delivery slice. Today's contract:
//
//   - off mode (any kind) → Skipped=1, no LLM calls, no DB writes;
//   - on mode             → Skipped=0, no LLM calls (yet), no DB writes;
//   - errors              → only on nil-arg programming bugs.
func RunWeekly(
	ctx context.Context,
	db *database.DB,
	settings WeeklySettingsReader,
) (WeeklyResult, error) {
	if db == nil {
		return WeeklyResult{}, fmt.Errorf("jobs: RunWeekly requires non-nil db")
	}
	if settings == nil {
		return WeeklyResult{}, fmt.Errorf("jobs: RunWeekly requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_digest_weekly").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return WeeklyResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_digest_weekly").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return WeeklyResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "digest-narration")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_digest_weekly").
			Str("feature_id", "digest-narration").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return WeeklyResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_digest_weekly").
			Str("feature_id", "digest-narration").
			Msg("digest-narration toggle off, skipping (per ADR-015 §I7)")
		return WeeklyResult{Skipped: 1}, nil
	}

	// On-mode path. The fan-out implementation (per-vehicle
	// narration + push delivery) lands in a future slice; today
	// the function returns a zeroed envelope so callers can pin
	// the shape and the off-mode test (TestRunAIDigestWeekly_*)
	// has a positive control to assert against.
	log.Debug().
		Str("job", "ai_digest_weekly").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return WeeklyResult{}, nil
}
