package api

// Phase-50 / 0028 — C3 Charging-curve fingerprint clustering.
//
// ai_charging_curve_clustering_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/charging/curves/clusters/explain. The
// flow mirrors ai_battery_health_handler.go (same dispatch+stream
// loop, no persistence — one-shot read-only narration):
//
//	URL  /api/v1/ai/charging/curves/clusters/explain
//	  ↓
//	resolve provider via *provider.Registry.For("charging-curve-fingerprint-clustering")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("charging-curve-fingerprint-clustering", …) so when
// ai_mode='off' or the per-feature toggle is off the guard returns
// 404 BEFORE this handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id) is parsed BEFORE opening the SSE
// stream so a malformed input surfaces as a plain JSON 400 (rather
// than a streamed error frame the SPA's QueryError will struggle
// to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /charging-curve page
//     (SummaryStatsGrid, SessionCurveChart, SessionComparisonChart,
//     ChargerTypeChart, SpeedTrendChart, TimeToChargeSection) and
//     the client-side `sessionLabel` heuristic in
//     web/src/features/charging/components/charging-curve/helpers.ts
//     are unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("charging-curve-fingerprint-clustering").
//   - I9 redaction:       PolicyChargingCurveFingerprintClustering
//     (allows ClassVehicleName only; lat/long, addresses, place
//     names stay tagged) is installed by dispatch.Run from the
//     strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	chargingcurvefingerprintclustering "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-curve-fingerprint-clustering"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiChargingCurveClusteringMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most retrieve_charge_curve_chunks →
// query_charge_curve_features → answer (with optional retries). A
// hard ceiling of 8 is generous, matching the other read-only
// narrators.
const aiChargingCurveClusteringMaxIterations = 8

// aiChargingCurveClusteringExplainRequest is the JSON body shape
// this handler accepts. Mirrors the
// /api/v1/analytics/charging-curve query-string contract —
// vehicle_id is the only required field — kept as a JSON body so
// the SPA can post from the same form state the deterministic UI
// already binds to.
type aiChargingCurveClusteringExplainRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// AIChargingCurveClusteringHandler is the HTTP handler for
// POST /api/v1/ai/charging/curves/clusters/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIChargingCurveClusteringHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIChargingCurveClusteringHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	retrieve_charge_curve_chunks AND query_charge_curve_features
//	(both registered by
//	tools.RegisterChargingCurveFingerprintClusteringTools in
//	router.go).
//
// strat:      the charging-curve-fingerprint-clustering Strategy.
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAIChargingCurveClusteringHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIChargingCurveClusteringHandler {
	switch {
	case registry == nil:
		panic("api: NewAIChargingCurveClusteringHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIChargingCurveClusteringHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIChargingCurveClusteringHandler: nil strategy.Strategy")
	}
	return &AIChargingCurveClusteringHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiChargingCurveClusteringMaxIterations,
	}
}

// parseChargingCurveClusteringExplainBody decodes + validates the
// JSON body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub deps.
// The function writes a 400 on failure and returns the (req, ok)
// pair so the caller can early-return.
func parseChargingCurveClusteringExplainBody(w http.ResponseWriter, r *http.Request) (*aiChargingCurveClusteringExplainRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiChargingCurveClusteringExplainRequest
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
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIChargingCurveClusteringHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseChargingCurveClusteringExplainBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), chargingcurvefingerprintclustering.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, chargingcurvefingerprintclustering.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(chargingcurvefingerprintclustering.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, chargingcurvefingerprintclustering.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook —
	// belt-and-braces against a future write tool sneaking past
	// review.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Cluster narration is NOT
	// conversational here — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to follow the
	// retrieve-then-query tool sequence and narrate the result.
	userMsg := fmt.Sprintf(
		"Name and explain the charging-curve fingerprint clusters for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call retrieve_charge_curve_chunks with a focused natural-language query "+
			"and source_types=[\"charge_curve\",\"charge_session\"] to ground your narration in "+
			"the user's own charging history, "+
			"(2) call query_charge_curve_features with vehicle_id=%d to get the deterministic "+
			"per-cluster envelope. "+
			"For each cluster the tool returns, give a short human-readable name (e.g. "+
			"\"Overnight L2 home charging\", \"Supercharger road-trip stops\") and ONE OR TWO "+
			"sentences explaining what makes the sessions in it cohere — quoting "+
			"session_count, peak_power_w_avg, dominant_charger_type, ramp_shape, and "+
			"total_energy_wh_avg from the tool reply, never inventing numbers. "+
			"Do NOT recompute, override, or contradict the cluster bucketing the tool returned. "+
			"If has_enough_data is false, say so plainly rather than inventing a cluster.",
		body.VehicleID, body.VehicleID,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai charging-curve-fingerprint-clustering: dispatcher returned error")
	}
}

// Compile-time assertion: AIChargingCurveClusteringHandler
// satisfies http.Handler.
var _ http.Handler = (*AIChargingCurveClusteringHandler)(nil)
