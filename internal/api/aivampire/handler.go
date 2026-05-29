package aivampire

// Phase-50 / 0030 — C5 vampire-drain explanation.
//
// Serves the opt-in SSE narrator for vampire-drain windows. The guard returns
// 404 before this handler runs when AI is off, and body validation happens
// before SSE so malformed input stays a JSON 400.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	vampiredrainexplanation "github.com/ev-dev-labs/teslasync/internal/ai/strategies/vampire-drain-explanation"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/lifetime"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// maxIterations bounds the read-only vampire-drain tool loop with room for retries.
const maxIterations = 8

// defaultLookbackDays is the default lookback when
// the request body omits the lookback_days field. Mirrors the
// canonical /vampire-drain/stats handler's
// vampireDrainStatsWindowDays constant (90 days). Kept as a named
// constant so a future tuning lives in one place rather than
// duplicated across the parser + the tool's Execute default.
const defaultLookbackDays = 90

// maxLookbackDays is the upper bound on the
// lookback_days parameter. Mirrors the canonical handler's
// per-feature 365-day ceiling; requests outside this window land
// as a 400 before any SQL runs.
const maxLookbackDays = 365

// request is the JSON body shape this handler
// accepts. The shape mirrors the /api/v1/vampire-drain?vehicle_id=
// query-string contract — vehicle_id is required, lookback_days is
// optional — kept as a JSON body so the SPA can post from the same
// form state the vampire-drain page already uses.
type request struct {
	VehicleID    int64 `json:"vehicle_id"`
	LookbackDays int   `json:"lookback_days,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/charging/vampire-drain/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler wires required AI dependencies and panics on nil so boot fails fast.
// toolReg must contain query_vampire_drain_windows and retrieve_idle_drain_chunks.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aivampire: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aivampire: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aivampire: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseBody validates input before SSE headers are written.
// lookback_days defaults when omitted and is bounded before any SQL runs.
func parseBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req request
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	if req.LookbackDays == 0 {
		req.LookbackDays = defaultLookbackDays
	}
	if req.LookbackDays < 1 || req.LookbackDays > maxLookbackDays {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("lookback_days must be between 1 and %d", maxLookbackDays))
		return nil, false
	}
	return &req, true
}

// denyAllConfirm is the dispatcher's user-confirm hook. The vampire-drain
// explanation strategy declares zero mutating tools, so this is never called
// in practice. If a future edit accidentally adds a mutating tool to the
// allowlist, the dispatcher rejects it instead of mutating fleet state.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseBody(w, r)
	if !ok {
		return
	}

	// Resolve before SSE so provider failures remain plain JSON.
	if _, err := h.registry.For(r.Context(), vampiredrainexplanation.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, vampiredrainexplanation.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(vampiredrainexplanation.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, vampiredrainexplanation.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirm is defense-in-depth if a mutating tool is ever added.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// No chat history exists here; this prompt forces read-only tools and honest uncertainty.
	userMsg := fmt.Sprintf(
		"Narrate the recent vampire drain (idle energy loss) for vehicle %d over the past %d days. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_vampire_drain_windows with vehicle_id=%d and lookback_days=%d to fetch the "+
			"deterministic envelope (event_count, total_observed_hours, avg / median / p95 drain_pct_per_day, "+
			"sample_window_days, the recent events list, and the worst recent event). "+
			"(2) OPTIONALLY call retrieve_idle_drain_chunks with vehicle_id-scoped natural-language queries "+
			"if you need additional per-event context — narrate gracefully when zero chunks are returned. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out the "+
			"recent average drain rate, whether it is in line with the typical fleet, and which "+
			"deterministic per-event driver (Sentry on, climate on, very long parked window) most "+
			"strongly correlates with the worst recent window. "+
			"ALWAYS describe the per-event driver attribution as CORRELATIONAL ('appears correlated with') "+
			"rather than CAUSAL ('caused by') — the deterministic repo derives windows from "+
			"fsm_transitions + signal_log, not from a controlled experiment. "+
			"Remember: you NEVER invent windows or fabricate ambient temperatures — you EXPLAIN the "+
			"signal. If event_count is 0 or the sample window is too short to be meaningful, say so "+
			"plainly rather than inventing a drivers list.",
		body.VehicleID, body.LookbackDays, body.VehicleID, body.LookbackDays,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("lookback_days", body.LookbackDays).
			Msg("ai vampire-drain-explanation: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

// Production wiring for the vampire-drain tool port stays local to this slice.

// Source delegates to the same repo used by the deterministic vampire-drain endpoints.
// That keeps AI narration grounded in the chart data without adding SQL.
type Source struct {
	repo *drivedb.VampireDrainRepo
}

// NewSource panics on nil so wiring mistakes surface at boot.
func NewSource(repo *drivedb.VampireDrainRepo) *Source {
	if repo == nil {
		panic("aivampire: NewSource: nil *drivedb.VampireDrainRepo")
	}
	return &Source{repo: repo}
}

// Events implements lifetime.VampireDrainSource. Composes the SAME
// *drivedb.VampireDrainRepo.Events the canonical
// VampireDrainHandler.Events handler uses so the returned event
// slice is numerically identical to what GET /vampire-drain
// produces — the AI surface is grounded in the SAME deterministic
// repo the chart renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it merely re-uses the repo method.
func (a *Source) Events(ctx context.Context, vehicleID int64, windowStart time.Time, limit int) ([]drivedb.VampireDrainEvent, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai vampire-drain-explanation: vehicle_id must be > 0")
	}
	if limit <= 0 {
		return nil, errors.New("api ai vampire-drain-explanation: limit must be > 0")
	}
	out, err := a.repo.Events(ctx, vehicleID, windowStart, limit)
	if err != nil {
		return nil, fmt.Errorf("api ai vampire-drain-explanation: repo.Events: %w", err)
	}
	return out, nil
}

// Stats implements lifetime.VampireDrainSource. Composes the SAME
// *drivedb.VampireDrainRepo.Stats the canonical
// VampireDrainHandler.Stats handler uses so the returned rollup is
// numerically identical to what GET /vampire-drain/stats produces.
func (a *Source) Stats(ctx context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (drivedb.VampireDrainStats, error) {
	if vehicleID <= 0 {
		return drivedb.VampireDrainStats{}, errors.New("api ai vampire-drain-explanation: vehicle_id must be > 0")
	}
	if limit <= 0 {
		return drivedb.VampireDrainStats{}, errors.New("api ai vampire-drain-explanation: limit must be > 0")
	}
	out, err := a.repo.Stats(ctx, vehicleID, windowStart, sampleWindowDays, limit)
	if err != nil {
		return drivedb.VampireDrainStats{}, fmt.Errorf("api ai vampire-drain-explanation: repo.Stats: %w", err)
	}
	return out, nil
}

// Compile-time assertion: Source satisfies
// lifetime.VampireDrainSource.
var _ lifetime.VampireDrainSource = (*Source)(nil)
