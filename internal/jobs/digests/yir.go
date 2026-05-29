package digests

// RunYIR backs the `ai_yir_pregen` background job registered for
// year-in-review narration.
//
// The job is fail-closed: every tick re-reads settings and refuses to run
// when ai_mode or the per-feature toggle is off (ADR-015 §I12 #3). The
// current implementation ships the gate and telemetry envelope before the
// fan-out implementation so the off-mode invariant is provable.

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// YIRSettingsReader is the narrow view of
// [settingsdb.SettingsRepo] [RunYIR] depends on. Defined
// inline so callers can supply a fake without dragging the full
// settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin who
// disables yir-narration mid-cycle sees the next run no-op
// immediately (no waiting for the worker pool to recycle).
type YIRSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// YIRResult reports the outcome of one tick. The fields are int so
// the fan-out implementation can tally per-vehicle narrations and push
// deliveries without changing the envelope.
type YIRResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode was
	// off OR the per-feature toggle was off. Reported separately
	// from "no work to do" so the ops dashboard can distinguish a
	// degraded settings table from an idle cycle.
	Skipped int

	// VehiclesConsidered is the number of vehicles the tick fanned out a
	// narration request for. It stays in the envelope even before fan-out
	// is implemented so callers can pin the response shape.
	VehiclesConsidered int

	// Narrated is the number of vehicles whose narration was successfully produced.
	Narrated int

	// Failed is the number of vehicles whose narration failed.
	Failed int
}

// RunYIR is the periodic cron entry for yir-narration fan-out. It
// pre-generates each vehicle's year-in-review narration so the slide deck
// loads instantly when the user opens the page.
//
// Re-checks ai_mode + the per-feature toggle at execution time per
// ADR-015 §I12 #3 — the scheduler may have started this loop while
// AI was on, but the admin can flip ai_mode='off' OR disable the
// toggle at any moment and we MUST honour it immediately. If either
// gate is off the function returns ([YIRResult{Skipped:
// 1}], nil) without touching the LLM, the tools, or the push fan-out.
//
// Settings read failures are LOGGED WARN and treated as off (no
// fan-out). Fail-closed semantics: a degraded settings table must
// not silently leak narrations to off-mode users.
//
// The current implementation is a no-op gate until per-vehicle narration,
// push fan-out, and telemetry counters are implemented. Current contract:
//
//   - off mode (any kind) → Skipped=1, no LLM calls, no DB writes;
//   - on mode             → Skipped=0, no LLM calls (yet), no DB writes;
//   - errors              → only on nil-arg programming bugs.
func RunYIR(
	ctx context.Context,
	db *database.DB,
	settings YIRSettingsReader,
) (YIRResult, error) {
	if db == nil {
		return YIRResult{}, fmt.Errorf("jobs: RunYIR requires non-nil db")
	}
	if settings == nil {
		return YIRResult{}, fmt.Errorf("jobs: RunYIR requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_yir_pregen").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return YIRResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_yir_pregen").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return YIRResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "yir-narration")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_yir_pregen").
			Str("feature_id", "yir-narration").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return YIRResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_yir_pregen").
			Str("feature_id", "yir-narration").
			Msg("yir-narration toggle off, skipping (per ADR-015 §I7)")
		return YIRResult{Skipped: 1}, nil
	}

	// The on-mode path returns a zeroed envelope until fan-out is implemented,
	// giving callers a stable shape and tests a positive control.
	log.Debug().
		Str("job", "ai_yir_pregen").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return YIRResult{}, nil
}
