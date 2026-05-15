package api

// Phase-50 / 0029 — C4 Cost forecast narration.
//
// ai_cost_forecast_narration_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/charging/costs/forecast/narrate. The
// flow mirrors ai_battery_health_handler.go (same dispatch+stream
// loop, no persistence — one-shot read-only narration):
//
//	URL  /api/v1/ai/charging/costs/forecast/narrate
//	  ↓
//	resolve provider via *provider.Registry.For("cost-forecast-narration")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("cost-forecast-narration", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id + optional months) is parsed BEFORE
// opening the SSE stream so a malformed input surfaces as a plain
// JSON 400 (rather than a streamed error frame the SPA's
// QueryError will struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /cost-analysis page
//     (and its alias /charging/costs) — CostSummaryCards,
//     MonthlyCostChart, CostPerKwhChart, ChargerTypeBreakdown,
//     SavingsCalculator, MonthlyCostTable, TimeOfUseAnalysis,
//     CostForecastSection, LifetimeSummary, EnvironmentalImpact
//     hitting GET /api/v1/analytics/cost-forecast — is unchanged.
//     This handler is an OPT-IN add-on; off-mode users never see
//     it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("cost-forecast-narration").
//   - I9 redaction:       PolicyCostForecastNarration (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice. The tool envelope's
//     extra honest-uncertainty fields live in the AI-only typed
//     [tools.CostForecast] envelope, not on the baseline
//     /analytics/cost-forecast response.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	costforecastnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cost-forecast-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// aiCostForecastNarrationMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_cost_forecast → answer
// (with optional retries). A hard ceiling of 8 is generous,
// matching aiBatteryHealthMaxIterations /
// aiSmartChargeScheduleMaxIterations.
const aiCostForecastNarrationMaxIterations = 8

// aiCostForecastNarrationDefaultMonths is the default forecast
// horizon when the request body omits the months field. Mirrors
// the canonical GET /api/v1/analytics/cost-forecast?months=
// default. Kept as a named constant so a future tuning lives in
// one place rather than duplicated across the parser + the tool's
// Execute default.
const aiCostForecastNarrationDefaultMonths = 6

// aiCostForecastNarrationMaxMonths is the upper bound on the
// months horizon. Mirrors the canonical handler's parameter
// validation in cost_forecast_handler.go (months > 0 && months <=
// 24); requests outside this window land as a 400 before any SQL
// runs.
const aiCostForecastNarrationMaxMonths = 24

// aiCostForecastNarrationRequest is the JSON body shape this
// handler accepts. The shape mirrors the
// /api/v1/analytics/cost-forecast?vehicle_id=&months= query-
// string contract — vehicle_id is required, months is optional —
// kept as a JSON body so the SPA can post from the same form
// state the cost-analysis page already uses.
type aiCostForecastNarrationRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	Months    int   `json:"months,omitempty"`
}

// AICostForecastNarrationHandler is the HTTP handler for
// POST /api/v1/ai/charging/costs/forecast/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AICostForecastNarrationHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAICostForecastNarrationHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_cost_forecast (registered by
//	tools.RegisterCostForecastNarrationTools in router.go).
//
// strat:      the cost-forecast-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAICostForecastNarrationHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AICostForecastNarrationHandler {
	switch {
	case registry == nil:
		panic("api: NewAICostForecastNarrationHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAICostForecastNarrationHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAICostForecastNarrationHandler: nil strategy.Strategy")
	}
	return &AICostForecastNarrationHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiCostForecastNarrationMaxIterations,
	}
}

// parseCostForecastNarrationBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub
// deps. The function writes a 400 on failure and returns the
// (req, ok) pair so the caller can early-return.
//
// The months field defaults to
// aiCostForecastNarrationDefaultMonths when omitted (or zero) and
// is bounded to [1, aiCostForecastNarrationMaxMonths] so an
// out-of-range value lands as a 400 before any SSE stream is
// opened.
func parseCostForecastNarrationBody(w http.ResponseWriter, r *http.Request) (*aiCostForecastNarrationRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiCostForecastNarrationRequest
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
		req.Months = aiCostForecastNarrationDefaultMonths
	}
	if req.Months < 1 || req.Months > aiCostForecastNarrationMaxMonths {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("months must be between 1 and %d", aiCostForecastNarrationMaxMonths))
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AICostForecastNarrationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseCostForecastNarrationBody(w, r)
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

	// 3) Subject + feature-id annotations for audit/rate-limit.
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

// Compile-time assertion: AICostForecastNarrationHandler
// satisfies http.Handler.
var _ http.Handler = (*AICostForecastNarrationHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/cost_forecast.go. Kept in the same file as
// the handler so the wiring intent is local to the slice;
// mirrors the battery-health-forecast-narrative slice's
// AIBatteryHealthForecaster pattern.
// ---------------------------------------------------------------------

// AICostForecaster is the production tools.CostForecaster. It
// delegates to the SHARED api.ComputeCostForecast helper that
// also backs the canonical GET /api/v1/analytics/cost-forecast
// handler so the AI narration is grounded in the SAME
// deterministic forecast model the chart on /cost-analysis
// renders. No new SQL is added by this slice.
//
// Refactoring the existing CostForecastHandler.GetForecast to
// pull its core into the package-level ComputeCostForecast helper
// (and having both call sites use it) was the deliberate choice
// over duplicating the SQL/math here — the slice 0029 rubber-duck
// critique flagged duplicated SQL as a blocking issue.
//
// The struct holds *database.DB; the constructor panics on a
// nil so a wiring bug surfaces at boot.
type AICostForecaster struct {
	db *database.DB
}

// NewAICostForecaster constructs the adapter. Panics on a nil
// *database.DB so a wiring mistake surfaces at boot rather than
// as a nil-deref on first AI request.
func NewAICostForecaster(db *database.DB) *AICostForecaster {
	if db == nil {
		panic("api: NewAICostForecaster: nil *database.DB")
	}
	return &AICostForecaster{db: db}
}

// ForecastCosts implements tools.CostForecaster. Composes the
// SAME api.ComputeCostForecast helper *CostForecastHandler.GetForecast
// uses so the returned envelope is numerically identical (modulo
// rounding) to what GET /api/v1/analytics/cost-forecast produces
// — the AI surface is grounded in the SAME deterministic model
// the chart renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing
// output into the typed [tools.CostForecast] envelope the LLM
// can quote.
//
// Currency is left empty for now: the existing baseline response
// does not surface a currency code, and Phase-48's SI-canonical
// migration left cost_currency on charging_sessions but the
// aggregated `cost_decimal` already mixes currencies at the row
// level. Surfacing a single currency for the aggregate would
// require a separate query + assumption layer that lives outside
// this slice. The narrator's system prompt does not assume any
// currency code; it quotes raw dollar figures consistent with
// the chart.
func (a *AICostForecaster) ForecastCosts(ctx context.Context, vehicleID int64, months int) (*tools.CostForecast, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai cost-forecast-narration: vehicle_id must be > 0")
	}
	if months <= 0 {
		months = aiCostForecastNarrationDefaultMonths
	}

	resp, meta, err := ComputeCostForecast(ctx, a.db, vehicleID, months)
	if err != nil {
		return nil, fmt.Errorf("api ai cost-forecast-narration: ComputeCostForecast: %w", err)
	}

	// Reshape the wire-shape response + metadata into the
	// typed AI envelope. Field-by-field copy keeps the AI
	// envelope decoupled from any future widening of the
	// internal historicalMonth / forecastMonth structs (the
	// narrator should remain pinned to a stable shape).
	historical := make([]tools.CostForecastHistoricalMonth, 0, len(resp.Historical))
	for _, m := range resp.Historical {
		historical = append(historical, tools.CostForecastHistoricalMonth{
			Month:      m.Month,
			Cost:       m.Cost,
			KWh:        m.KWh,
			Sessions:   m.Sessions,
			CostPerKWh: m.CostPerKWh,
		})
	}
	forecast := make([]tools.CostForecastFutureMonth, 0, len(resp.Forecast))
	for _, m := range resp.Forecast {
		forecast = append(forecast, tools.CostForecastFutureMonth{
			Month:    m.Month,
			Cost:     m.Cost,
			CostLow:  m.CostLow,
			CostHigh: m.CostHigh,
			KWh:      m.KWh,
		})
	}

	insights := append([]string(nil), resp.Insights...)
	assumptions := append([]string(nil), meta.Assumptions...)

	return &tools.CostForecast{
		VehicleID:            vehicleID,
		Currency:             "", // see method-level doc comment
		HistoricalMonthCount: meta.HistoricalMonthCount,
		MinRequiredMonths:    meta.MinRequiredMonths,
		HasEnoughData:        meta.HasEnoughData,
		DataThroughMonth:     meta.DataThroughMonth,
		ForecastMonths:       meta.ForecastMonths,
		ForecastMethod:       meta.ForecastMethod,
		UncertaintyMethod:    meta.UncertaintyMethod,
		UncertaintyLevel:     meta.UncertaintyLevel,
		Assumptions:          assumptions,
		Historical:           historical,
		Forecast:             forecast,
		Breakdown: tools.CostForecastBreakdown{
			Home: tools.CostForecastChargerCategory{
				Pct:           resp.Breakdown.Home.Pct,
				AvgCostPerKWh: resp.Breakdown.Home.AvgCostPerKWh,
				MonthlyAvg:    resp.Breakdown.Home.MonthlyAvg,
			},
			Supercharger: tools.CostForecastChargerCategory{
				Pct:           resp.Breakdown.Supercharger.Pct,
				AvgCostPerKWh: resp.Breakdown.Supercharger.AvgCostPerKWh,
				MonthlyAvg:    resp.Breakdown.Supercharger.MonthlyAvg,
			},
		},
		GasComparison: tools.CostForecastGasComparison{
			AvgKmPerMonth:   resp.GasComparison.AvgKmPerMonth,
			GasCostPerMonth: resp.GasComparison.GasCostPerMonth,
			EvCostPerMonth:  resp.GasComparison.EvCostPerMonth,
			MonthlySavings:  resp.GasComparison.MonthlySavings,
			AnnualSavings:   resp.GasComparison.AnnualSavings,
			LifetimeSavings: resp.GasComparison.LifetimeSavings,
		},
		Insights: insights,
	}, nil
}

// Compile-time assertion: AICostForecaster satisfies
// tools.CostForecaster.
var _ tools.CostForecaster = (*AICostForecaster)(nil)
