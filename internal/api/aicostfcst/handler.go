package aicostfcst

// Phase-50 / 0029 — C4 Cost forecast narration.
//
// This is the opt-in LLM narration layer for POST /api/v1/ai/charging/costs/forecast/narrate.
// The guard returns 404 before this handler runs when AI or the feature is disabled (ADR-015 §I6).
// Body validation happens before SSE opens so malformed input remains a plain JSON 400.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	costforecastnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cost-forecast-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_cost_forecast → answer
// (with optional retries). A hard ceiling of 8 is generous,
// matching aiBatteryHealthMaxIterations /
// aiSmartChargeScheduleMaxIterations.
const maxIterations = 8

// defaultMonths is the default forecast
// horizon when the request body omits the months field. Mirrors
// the canonical GET /api/v1/analytics/cost-forecast?months=
// default. Kept as a named constant so a future tuning lives in
// one place rather than duplicated across the parser + the tool's
// Execute default.
const defaultMonths = 6

// maxMonths is the upper bound on the
// months horizon. Mirrors the canonical handler's parameter
// validation in cost_forecast_handler.go (months > 0 && months <=
// 24); requests outside this window land as a 400 before any SQL
// runs.
const maxMonths = 24

// request is the JSON body shape this
// handler accepts. The shape mirrors the
// /api/v1/analytics/cost-forecast?vehicle_id=&months= query-
// string contract — vehicle_id is required, months is optional —
// kept as a JSON body so the SPA can post from the same form
// state the cost-analysis page already uses.
type request struct {
	VehicleID int64 `json:"vehicle_id"`
	Months    int   `json:"months,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/charging/costs/forecast/narrate.
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

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_cost_forecast (registered by
//	forecast.RegisterCostForecastNarrationTools in router.go).
//
// strat:      the cost-forecast-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aicostfcst: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aicostfcst: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aicostfcst: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub
// deps. The function writes a 400 on failure and returns the
// (req, ok) pair so the caller can early-return.
//
// The months field defaults to
// defaultMonths when omitted (or zero) and
// is bounded to [1, maxMonths] so an
// out-of-range value lands as a 400 before any SSE stream is
// opened.
func parseBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req request
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
	if req.Months == 0 {
		req.Months = defaultMonths
	}
	if req.Months < 1 || req.Months > maxMonths {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("months must be between 1 and %d", maxMonths))
		return nil, false
	}
	return &req, true
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

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), costforecastnarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai cost-forecast-narration: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, costforecastnarration.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(costforecastnarration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai cost-forecast-narration: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	// (now-annotated) context.
	prov, err := h.registry.For(ctx, costforecastnarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai cost-forecast-narration: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Cost-forecast narration
	// is NOT conversational here — there is no chat history.
	// We hand the LLM a deterministic prompt that asks it to
	// call the single read-only tool in scope and narrate the
	// result, with explicit honest-uncertainty cues so the
	// narration discloses the forecast method + the
	// approximate (NOT strict 95% CI) nature of the band.
	userMsg := fmt.Sprintf(
		"Narrate the charging-cost forecast for vehicle %d over the next %d months. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_cost_forecast with vehicle_id=%d and months=%d to fetch the deterministic "+
			"forecast envelope. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out the "+
			"historical trend, the projected band (cost / cost_low / cost_high), the home-vs-supercharger "+
			"split if material, and the most relevant deterministic insight. "+
			"ALWAYS surface the forecast_method and describe the band as an APPROXIMATE prediction interval "+
			"(NOT a strict 95%% confidence interval). "+
			"Remember: you NEVER change the forecast or invent dollar amounts — you EXPLAIN it. "+
			"If has_enough_data is false, say so plainly rather than inventing a slope or projected dollar amount.",
		body.VehicleID, body.Months, body.VehicleID, body.Months,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("months", body.Months).
			Msg("ai cost-forecast-narration: dispatcher returned error")
	}
}

// Compile-time assertion: Handler
// satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}
