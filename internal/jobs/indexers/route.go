package indexers

// Route-efficiency indexing runs as a scheduled job so expensive
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

// RouteSettingsReader is the narrow view of
// [settingsdb.SettingsRepo] [RunRoute] depends on. Defined
// inline so callers can supply a fake without dragging the full
// settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin
// who disables route-efficiency-suggestions mid-day sees the
// next run no-op immediately (no waiting for the worker pool to
// recycle).
type RouteSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// RouteResult reports one tick. Counts stay zero until the fan-out
// implementation is wired.
type RouteResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode
	// was off OR the per-feature toggle was off. Reported
	// separately from "no work to do" so the ops dashboard can
	// distinguish a degraded settings table from an idle day.
	Skipped int

	// SourcesConsidered counts source rows considered for re-embedding
	// across drive_summary, route_efficiency, and weather_context.
	SourcesConsidered int

	// Indexed is the number of source rows re-embedded successfully.
	Indexed int

	// Failed is the number of source rows whose re-embed failed.
	Failed int
}

// RunRoute is the scheduled route-efficiency background fan-out.
//
// Re-checks ai_mode + the per-feature toggle at execution time
// per ADR-015 §I12 #3 — the scheduler may have started this loop
// while AI was on, but the admin can flip ai_mode='off' OR
// disable the toggle at any moment and we MUST honour it
// immediately. If either gate is off the function returns
// ([RouteResult{Skipped: 1}], nil) without touching the
// LLM, the embedder, or the vector DB.
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
func RunRoute(
	ctx context.Context,
	db *database.DB,
	settings RouteSettingsReader,
) (RouteResult, error) {
	if db == nil {
		return RouteResult{}, fmt.Errorf("jobs: RunRoute requires non-nil db")
	}
	if settings == nil {
		return RouteResult{}, fmt.Errorf("jobs: RunRoute requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_route_indexer").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return RouteResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_route_indexer").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return RouteResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "route-efficiency-suggestions")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_route_indexer").
			Str("feature_id", "route-efficiency-suggestions").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return RouteResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_route_indexer").
			Str("feature_id", "route-efficiency-suggestions").
			Msg("route-efficiency-suggestions toggle off, skipping (per ADR-015 §I7)")
		return RouteResult{Skipped: 1}, nil
	}

	// With both gates open, return the stable envelope until fan-out is wired.
	log.Debug().
		Str("job", "ai_route_indexer").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return RouteResult{}, nil
}
