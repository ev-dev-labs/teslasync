package api

// Phase-50 / 0050 — M2 TCO narration.
//
// ai_tco_narration_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/analytics/tco/narrate. The flow mirrors
// ai_cost_forecast_narration_handler.go (same dispatch+stream
// loop, no persistence — one-shot read-only narration):
//
//	URL  /api/v1/ai/analytics/tco/narrate
//	  ↓
//	resolve provider via *provider.Registry.For("tco-narration")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("tco-narration", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id) is parsed BEFORE opening the SSE
// stream so a malformed input surfaces as a plain JSON 400
// (rather than a streamed error frame the SPA's QueryError will
// struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /tco page (and its
//     alias /analytics/tco) — TrueCostPage with TCOHero,
//     TCOSummaryCards, CostOverTimeChart, MonthlyBreakdownTable,
//     AssumptionsPanel hitting GET /api/v1/analytics/tco — is
//     unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("tco-narration").
//   - I9 redaction:       PolicyTCONarration (allows
//     ClassVehicleName only; lat/long, addresses, place names
//     stay tagged) is installed by dispatch.Run from the
//     strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON
//     shape is added or modified by this slice. The tool
//     envelope's extra honest-scope `assumptions` array lives
//     in the AI-only typed [lifetime.TCOSummary] envelope, not on
//     the baseline /analytics/tco response.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	tconarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/tco-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/lifetime"
	apitco "github.com/ev-dev-labs/teslasync/internal/api/tco"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// aiTCONarrationMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most query_tco_summary → answer (with
// optional retries). A hard ceiling of 8 is generous, matching
// aiCostForecastNarrationMaxIterations / aiBatteryHealthMaxIterations.
const aiTCONarrationMaxIterations = 8

// aiTCONarrationRequest is the JSON body shape this handler
// accepts. The shape mirrors the
// /api/v1/analytics/tco?vehicle_id= query-string contract —
// vehicle_id is the ONLY required field. Kept as a JSON body so
// the SPA can post from the same form state TrueCostPage already
// uses.
type aiTCONarrationRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// AITCONarrationHandler is the HTTP handler for
// POST /api/v1/ai/analytics/tco/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AITCONarrationHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAITCONarrationHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_tco_summary (registered by
//	lifetime.RegisterTCONarrationTools in router.go).
//
// strat:      the tco-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAITCONarrationHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AITCONarrationHandler {
	switch {
	case registry == nil:
		panic("api: NewAITCONarrationHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAITCONarrationHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAITCONarrationHandler: nil strategy.Strategy")
	}
	return &AITCONarrationHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiTCONarrationMaxIterations,
	}
}

// parseTCONarrationBody decodes + validates the JSON body.
// Pulled out so the validator-only test can exercise the same
// parsing without constructing a full handler with stub deps.
// The function writes a 400 on failure and returns the (req, ok)
// pair so the caller can early-return.
func parseTCONarrationBody(w http.ResponseWriter, r *http.Request) (*aiTCONarrationRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiTCONarrationRequest
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
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the writer
// has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AITCONarrationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseTCONarrationBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), tconarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai tco-narration: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, tconarration.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(tconarration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai tco-narration: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	// (now-annotated) context.
	prov, err := h.registry.For(ctx, tconarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai tco-narration: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. TCO narration is NOT
	// conversational here — there is no chat history. We
	// hand the LLM a deterministic prompt that asks it to
	// call the single read-only tool in scope and narrate
	// the result, with explicit limiting-assumption cues so
	// the narration discloses the four caveats baked into
	// the deterministic envelope.
	userMsg := fmt.Sprintf(
		"Narrate the operating-cost envelope for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_tco_summary with vehicle_id=%d to fetch the deterministic ownership-cost envelope. "+
			"Narrate the result in 3-5 sentences grounded strictly in the tool reply, calling out the dominant savings "+
			"driver (cost_per_km_ev vs cost_per_km_ice gap, total_savings, monthly_savings, sessions count, monthly trend), "+
			"AT LEAST ONE of the four limiting assumptions (operating-cost only, $50/mo maintenance heuristic, per-month gas "+
			"equivalent estimated from energy not distance, settings-driven gas/electricity defaults), and an honest "+
			"data-quality note when total_sessions=0 or months_of_ownership=1. "+
			"If total_savings is NEGATIVE, say so PLAINLY and HONESTLY — never cheerlead, never recommend buying or "+
			"switching to a gas vehicle. "+
			"Remember: you NEVER change the numbers or invent dollar amounts — you EXPLAIN the deterministic envelope.",
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
			Msg("ai tco-narration: dispatcher returned error")
	}
}

// Compile-time assertion: AITCONarrationHandler satisfies
// http.Handler.
var _ http.Handler = (*AITCONarrationHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/tco_summary.go. Kept in the same file as the
// handler so the wiring intent is local to the slice; mirrors
// the cost-forecast-narration slice's AICostForecaster pattern.
// ---------------------------------------------------------------------

// AITCOSummarizer is the production lifetime.TCOSummarizer. It
// delegates to the SHARED api.ComputeTCOSummary helper that
// also backs the canonical GET /api/v1/analytics/tco handler so
// the AI narration is grounded in the SAME deterministic
// envelope the chart on /tco renders. No new SQL is added by
// this slice.
//
// Refactoring the existing TCOHandler.GetTCO to pull its core
// into the package-level ComputeTCOSummary helper (and having
// both call sites use it) was the deliberate choice over
// duplicating the SQL/math here — the slice 0050 rubber-duck
// critique flagged duplicated SQL as a blocking issue, mirroring
// the slice 0029 cost-forecast precedent.
//
// The struct holds *database.DB; the constructor panics on a
// nil so a wiring bug surfaces at boot.
type AITCOSummarizer struct {
	db *database.DB
}

// NewAITCOSummarizer constructs the adapter. Panics on a nil
// *database.DB so a wiring mistake surfaces at boot rather than
// as a nil-deref on first AI request.
func NewAITCOSummarizer(db *database.DB) *AITCOSummarizer {
	if db == nil {
		panic("api: NewAITCOSummarizer: nil *database.DB")
	}
	return &AITCOSummarizer{db: db}
}

// SummarizeTCO implements lifetime.TCOSummarizer. Composes the SAME
// api.ComputeTCOSummary helper *TCOHandler.GetTCO uses so the
// returned envelope is numerically identical (modulo rounding)
// to what GET /api/v1/analytics/tco produces — the AI surface
// is grounded in the SAME deterministic model the chart
// renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing
// output into the typed [lifetime.TCOSummary] envelope the LLM can
// quote, then attaches the four limiting-assumption strings the
// system prompt also names (defence in depth — the tool reply
// itself disclaims, so a future drift in the prompt does not
// silently lose the disclosure).
//
// Currency is left empty for now: the existing baseline
// response does not surface a currency code, and Phase-48's
// SI-canonical migration left cost_currency on charging_sessions
// but the aggregated `cost_decimal` already mixes currencies at
// the row level. Surfacing a single currency for the aggregate
// would require a separate query + assumption layer that lives
// outside this slice.
func (a *AITCOSummarizer) SummarizeTCO(ctx context.Context, vehicleID int64) (*lifetime.TCOSummary, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai tco-narration: vehicle_id must be > 0")
	}

	summary, err := apitco.ComputeTCOSummary(ctx, a.db, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("api ai tco-narration: ComputeTCOSummary: %w", err)
	}

	monthly := make([]lifetime.TCOMonthlyEntry, 0, len(summary.MonthlyBreakdown))
	for _, m := range summary.MonthlyBreakdown {
		monthly = append(monthly, lifetime.TCOMonthlyEntry{
			Month:        m.Month,
			EVCost:       m.EVCost,
			EquivGasCost: m.EquivGasCost,
			Savings:      m.Savings,
			CumSavings:   m.CumSavings,
			EnergyWh:     m.EnergyWh,
		})
	}

	return &lifetime.TCOSummary{
		VehicleID:                  summary.VehicleID,
		Currency:                   "", // see method-level doc comment
		TotalChargingCost:          summary.TotalChargingCost,
		TotalWh:                    summary.TotalWh,
		TotalSessions:              summary.TotalSessions,
		TotalKm:                    summary.TotalKm,
		FirstDate:                  summary.FirstDate,
		LastDate:                   summary.LastDate,
		MonthsOfOwnership:          summary.MonthsOfOwnership,
		CostPerKmEV:                summary.CostPerKmEV,
		CostPerKmICE:               summary.CostPerKmICE,
		EquivalentGasCost:          summary.EquivalentGasCost,
		TotalSavings:               summary.TotalSavings,
		MonthlySavings:             summary.MonthlySavings,
		MaintenanceSavingsEstimate: summary.MaintenanceSavingsEstimate,
		GasPrice:                   summary.GasPrice,
		GasEfficiencyMPG:           summary.GasEfficiencyMPG,
		BaseCostPerKWh:             summary.BaseCostPerKWh,
		MonthlyBreakdown:           monthly,
		Assumptions: []string{
			"Operating cost only — vehicle purchase price, depreciation, insurance, registration, taxes, financing, and resale value are NOT included; this is NOT full Total Cost of Ownership in the accounting sense.",
			"maintenance_savings_estimate is a flat $50-per-month heuristic, NOT a real per-vehicle service-record sum.",
			"Per-month equivalent_gas_cost in monthly_breakdown is ESTIMATED from each month's charging energy rather than from actual per-month distance, so a month with low charging but high driving will appear cheaper than reality.",
			"gas_price, gas_efficiency_mpg, and base_cost_per_kwh come from user-editable settings — when the user has not configured them the deterministic defaults apply (25 MPG, $3.50/gal, $0.12/kWh).",
		},
	}, nil
}

// Compile-time assertion: AITCOSummarizer satisfies
// lifetime.TCOSummarizer.
var _ lifetime.TCOSummarizer = (*AITCOSummarizer)(nil)
