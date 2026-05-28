package indexers

// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// ai_drive_indexer.go is the cross-cutting cron stub that the
// nl-drive-search-replay slice registers as its background-job
// surface (`ai_drive_indexer` in the features registry's JobNames
// list).
//
// The stub is fail-closed by design: every tick re-reads the
// settings table and refuses to do anything when ai_mode is off
// OR the per-feature toggle is off (ADR-015 §I12 #3 — "background
// dispatcher gate trips before execution"). The real fan-out
// implementation (re-embed drive_summary / route_segment /
// location_summary chunks into the F7 vector store keyed under
// the calling user_subject so retrieve_drive_chunks sees fresh
// chunks) will land alongside a future indexer-fan-out slice;
// this file ships the gate + telemetry envelope so the off-mode
// invariant is provable today.
//
// The function is exported so a future scheduler (cmd/scheduler
// or the existing internal/worker pool) can install it on a
// once-per-day cron without further plumbing changes.
//
// Why a job and not an inline indexer:
//
//   - The drive corpus is per-user (drives belong to a user); a
//     single scheduled tick walks every user_subject and
//     re-embeds the drive_summary / route_segment /
//     location_summary chunks that changed since the last tick.
//     Today's F7 indexer only covers drive_summary;
//     ai_drive_indexer extends that to the two forward-compat
//     corpora once wired.
//   - Embedding is expensive (each chunk is one LLM call); doing
//     it inline on every retrieve_drive_chunks request would burn
//     cost + latency for stale data. Batching at job time
//     amortises both.
//   - Off-mode users MUST NOT pay for embeddings they cannot use;
//     the fail-closed gate makes that contract structurally
//     impossible to violate.

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// DriveSettingsReader is the narrow view of
// [database.SettingsRepo] [RunDrive] depends on. Defined
// inline so callers can supply a fake without dragging the full
// settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin
// who disables nl-drive-search-replay mid-day sees the next run
// no-op immediately (no waiting for the worker pool to recycle).
type DriveSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// DriveResult reports the outcome of one tick. The
// fields are all int because the real fan-out implementation will
// tally per-source re-embed counts here; today the values stay
// zero (the stub is a no-op when off, and a no-op-with-log when
// on — the actual indexing lands in a future slice).
type DriveResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode
	// was off OR the per-feature toggle was off. Reported
	// separately from "no work to do" so the ops dashboard can
	// distinguish a degraded settings table from an idle day.
	Skipped int

	// SourcesConsidered is the number of source rows (across
	// drive_summary / route_segment / location_summary) the tick
	// fanned out a re-embed request for. Always 0 in this slice
	// (the fan-out implementation lands in a future slice); the
	// field is in the envelope so callers can pin the shape
	// today.
	SourcesConsidered int

	// Indexed is the number of sources whose re-embed succeeded.
	// Always 0 in this slice.
	Indexed int

	// Failed is the number of sources whose re-embed failed.
	// Always 0 in this slice.
	Failed int
}

// RunDrive is the once-per-day cron entry for the
// nl-drive-search-replay slice's background fan-out.
//
// Re-checks ai_mode + the per-feature toggle at execution time
// per ADR-015 §I12 #3 — the scheduler may have started this loop
// while AI was on, but the admin can flip ai_mode='off' OR
// disable the toggle at any moment and we MUST honour it
// immediately. If either gate is off the function returns
// ([DriveResult{Skipped: 1}], nil) without touching the
// LLM, the embedder, or the vector DB.
//
// Settings read failures are LOGGED WARN and treated as off (no
// fan-out). Fail-closed semantics: a degraded settings table
// must not silently leak embedding API calls to off-mode users.
//
// The current implementation is deliberately a no-op gate. The
// per-source re-embed loop, the chunking + cleanup logic, and
// the telemetry counters land in a future indexer-fan-out slice.
// Today's contract:
//
//   - off mode (any kind) → Skipped=1, no embed calls, no DB writes;
//   - on mode             → Skipped=0, no embed calls (yet), no DB writes;
//   - errors              → only on nil-arg programming bugs.
func RunDrive(
	ctx context.Context,
	db *database.DB,
	settings DriveSettingsReader,
) (DriveResult, error) {
	if db == nil {
		return DriveResult{}, fmt.Errorf("jobs: RunDrive requires non-nil db")
	}
	if settings == nil {
		return DriveResult{}, fmt.Errorf("jobs: RunDrive requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_drive_indexer").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return DriveResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_drive_indexer").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return DriveResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "nl-drive-search-replay")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_drive_indexer").
			Str("feature_id", "nl-drive-search-replay").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return DriveResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_drive_indexer").
			Str("feature_id", "nl-drive-search-replay").
			Msg("nl-drive-search-replay toggle off, skipping (per ADR-015 §I7)")
		return DriveResult{Skipped: 1}, nil
	}

	// On-mode path. The fan-out implementation (per-source
	// re-embed + chunking + cleanup) lands in a future slice;
	// today the function returns a zeroed envelope so callers
	// can pin the shape and the off-mode test
	// (TestRunAIDriveIndexer_*) has a positive control to assert
	// against.
	log.Debug().
		Str("job", "ai_drive_indexer").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return DriveResult{}, nil
}
