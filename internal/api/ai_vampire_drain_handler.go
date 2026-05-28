package api

// Phase-50 / 0030 — C5 Vampire-drain explanation.
//
// ai_vampire_drain_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/charging/vampire-drain/explain. The flow mirrors
// ai_cost_forecast_narration_handler.go (same dispatch+stream loop,
// no persistence — one-shot read-only narration):
//
//	URL  /api/v1/ai/charging/vampire-drain/explain
//	  ↓
//	resolve provider via *provider.Registry.For("vampire-drain-explanation")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("vampire-drain-explanation", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id + optional lookback_days) is parsed
// BEFORE opening the SSE stream so a malformed input surfaces as a
// plain JSON 400 (rather than a streamed error frame the SPA's
// QueryError will struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /vampire-drain page
//     (and its alias /charging/vampire-drain) — summary cards,
//     drain-rate trend chart, daily-drain bar chart, drain-sessions
//     table, tips panel hitting GET /api/v1/vampire-drain +
//     /api/v1/vampire-drain/stats — is unchanged. This handler is
//     an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("vampire-drain-explanation").
//   - I9 redaction:       PolicyVampireDrainExplanation (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice. The tool envelope's
//     extra fields live in the AI-only typed envelope returned by
//     query_vampire_drain_windows, not on the baseline
//     /vampire-drain response.

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
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// aiVampireDrainMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most query_vampire_drain_windows →
// (optional) retrieve_idle_drain_chunks → answer (with optional
// retries). A hard ceiling of 8 is generous, matching
// aiCostForecastNarrationMaxIterations /
// aiBatteryHealthMaxIterations.
const aiVampireDrainMaxIterations = 8

// aiVampireDrainDefaultLookbackDays is the default lookback when
// the request body omits the lookback_days field. Mirrors the
// canonical /vampire-drain/stats handler's
// vampireDrainStatsWindowDays constant (90 days). Kept as a named
// constant so a future tuning lives in one place rather than
// duplicated across the parser + the tool's Execute default.
const aiVampireDrainDefaultLookbackDays = 90

// aiVampireDrainMaxLookbackDays is the upper bound on the
// lookback_days parameter. Mirrors the canonical handler's
// per-feature 365-day ceiling; requests outside this window land
// as a 400 before any SQL runs.
const aiVampireDrainMaxLookbackDays = 365

// aiVampireDrainRequest is the JSON body shape this handler
// accepts. The shape mirrors the /api/v1/vampire-drain?vehicle_id=
// query-string contract — vehicle_id is required, lookback_days is
// optional — kept as a JSON body so the SPA can post from the same
// form state the vampire-drain page already uses.
type aiVampireDrainRequest struct {
	VehicleID    int64 `json:"vehicle_id"`
	LookbackDays int   `json:"lookback_days,omitempty"`
}

// AIVampireDrainHandler is the HTTP handler for
// POST /api/v1/ai/charging/vampire-drain/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIVampireDrainHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIVampireDrainHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_vampire_drain_windows + retrieve_idle_drain_chunks
//	(registered by lifetime.RegisterVampireDrainExplanationTools
//	in router.go).
//
// strat:      the vampire-drain-explanation Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIVampireDrainHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIVampireDrainHandler {
	switch {
	case registry == nil:
		panic("api: NewAIVampireDrainHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIVampireDrainHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIVampireDrainHandler: nil strategy.Strategy")
	}
	return &AIVampireDrainHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiVampireDrainMaxIterations,
	}
}

// parseVampireDrainBody decodes + validates the JSON body. Pulled
// out so the validator-only test can exercise the same parsing
// without constructing a full handler with stub deps. The function
// writes a 400 on failure and returns the (req, ok) pair so the
// caller can early-return.
//
// The lookback_days field defaults to
// aiVampireDrainDefaultLookbackDays when omitted (or zero) and is
// bounded to [1, aiVampireDrainMaxLookbackDays] so an out-of-range
// value lands as a 400 before any SSE stream is opened.
func parseVampireDrainBody(w http.ResponseWriter, r *http.Request) (*aiVampireDrainRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiVampireDrainRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	if req.LookbackDays == 0 {
		req.LookbackDays = aiVampireDrainDefaultLookbackDays
	}
	if req.LookbackDays < 1 || req.LookbackDays > aiVampireDrainMaxLookbackDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("lookback_days must be between 1 and %d", aiVampireDrainMaxLookbackDays))
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIVampireDrainHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseVampireDrainBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), vampiredrainexplanation.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, vampiredrainexplanation.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(vampiredrainexplanation.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	// (now-annotated) context.
	prov, err := h.registry.For(ctx, vampiredrainexplanation.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai vampire-drain-explanation: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Vampire-drain narration
	// is NOT conversational here — there is no chat history.
	// We hand the LLM a deterministic prompt that asks it to
	// call the read-only tools in scope and narrate the
	// result, with explicit honest-uncertainty cues so the
	// narration discloses the correlational nature of the
	// per-event driver attribution.
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

	// 8) Run the dispatcher.
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

// Compile-time assertion: AIVampireDrainHandler satisfies http.Handler.
var _ http.Handler = (*AIVampireDrainHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/vampire_drain_explanation.go. Kept in the same
// file as the handler so the wiring intent is local to the slice;
// mirrors the cost-forecast-narration slice's AICostForecaster
// pattern.
// ---------------------------------------------------------------------

// AIVampireDrainSource is the production lifetime.VampireDrainSource.
// It delegates to the SHARED *drivedb.VampireDrainRepo that also
// backs the canonical baseline GET /vampire-drain + GET
// /vampire-drain/stats handlers so the AI narration is grounded in
// the SAME deterministic envelope the chart on /vampire-drain
// renders. No new SQL is added by this slice.
//
// The struct holds *drivedb.VampireDrainRepo; the constructor
// panics on a nil so a wiring bug surfaces at boot.
type AIVampireDrainSource struct {
	repo *drivedb.VampireDrainRepo
}

// NewAIVampireDrainSource constructs the adapter. Panics on a nil
// *drivedb.VampireDrainRepo so a wiring mistake surfaces at boot
// rather than as a nil-deref on first AI request.
func NewAIVampireDrainSource(repo *drivedb.VampireDrainRepo) *AIVampireDrainSource {
	if repo == nil {
		panic("api: NewAIVampireDrainSource: nil *drivedb.VampireDrainRepo")
	}
	return &AIVampireDrainSource{repo: repo}
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
func (a *AIVampireDrainSource) Events(ctx context.Context, vehicleID int64, windowStart time.Time, limit int) ([]drivedb.VampireDrainEvent, error) {
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
func (a *AIVampireDrainSource) Stats(ctx context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (drivedb.VampireDrainStats, error) {
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

// Compile-time assertion: AIVampireDrainSource satisfies
// lifetime.VampireDrainSource.
var _ lifetime.VampireDrainSource = (*AIVampireDrainSource)(nil)
