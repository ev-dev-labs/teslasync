package triage

// Feedback triage indexing runs as a scheduled job so expensive
// embedding work is batched instead of paid on every retrieval.
//
// The gate is fail-closed: every tick re-reads ai_mode and the
// per-feature toggle before touching the LLM, embedder, or vector DB.
// This preserves ADR-015 §I12 even if an admin disables AI while the
// scheduler keeps running.

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// FeedbackSettingsReader is the narrow view of
// [settingsdb.SettingsRepo] [RunFeedback] depends
// on. Defined inline so callers can supply a fake without
// dragging the full settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin
// who disables feedback-queue-triage mid-day sees the next run
// no-op immediately (no waiting for the worker pool to recycle).
type FeedbackSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// FeedbackResult reports one tick. Counts stay zero until the fan-out
// implementation is wired.
type FeedbackResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode
	// was off OR the per-feature toggle was off. Reported
	// separately from "no work to do" so the ops dashboard can
	// distinguish a degraded settings table from an idle day.
	Skipped int

	// SourcesConsidered counts feedback_item and audit_log rows considered
	// for re-embedding.
	SourcesConsidered int

	// Indexed is the number of source rows re-embedded successfully.
	Indexed int

	// Failed is the number of source rows whose re-embed failed.
	Failed int
}

// RunFeedback is the scheduled feedback-triage background fan-out.
//
// Re-checks ai_mode + the per-feature toggle at execution time
// per ADR-015 §I12 #3 — the scheduler may have started this loop
// while AI was on, but the admin can flip ai_mode='off' OR
// disable the toggle at any moment and we MUST honour it
// immediately. If either gate is off the function returns
// ([FeedbackResult{Skipped: 1}], nil) without touching
// the LLM, the embedder, or the vector DB.
//
// Settings read failures are LOGGED WARN and treated as off (no
// fan-out). Fail-closed semantics: a degraded settings table
// must not silently leak embedding API calls to off-mode users.
//
// The current implementation is deliberately a no-op gate until
// per-source re-embedding, chunk cleanup, and telemetry counters are wired.
// Contract:
//
//   - off mode (any kind) → Skipped=1, no embed calls, no DB writes;
//   - on mode             → Skipped=0, no embed calls (yet), no DB writes;
//   - errors              → only on nil-arg programming bugs.
func RunFeedback(
	ctx context.Context,
	db *database.DB,
	settings FeedbackSettingsReader,
) (FeedbackResult, error) {
	if db == nil {
		return FeedbackResult{}, fmt.Errorf("jobs: RunFeedback requires non-nil db")
	}
	if settings == nil {
		return FeedbackResult{}, fmt.Errorf("jobs: RunFeedback requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_feedback_triage").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return FeedbackResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_feedback_triage").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return FeedbackResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "feedback-queue-triage")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_feedback_triage").
			Str("feature_id", "feedback-queue-triage").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return FeedbackResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_feedback_triage").
			Str("feature_id", "feedback-queue-triage").
			Msg("feedback-queue-triage toggle off, skipping (per ADR-015 §I7)")
		return FeedbackResult{Skipped: 1}, nil
	}

	// With both gates open, return the stable envelope until fan-out is wired.
	log.Debug().
		Str("job", "ai_feedback_triage").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return FeedbackResult{}, nil
}
