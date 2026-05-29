package aitconar

// Phase-50 / 0050 — M2 TCO narration.
// This opt-in AI handler streams narration over the deterministic TCO summary;
// guard.Wrap enforces ADR-015 off-mode and per-feature gating before provider
// resolution.

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
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	apitco "github.com/ev-dev-labs/teslasync/internal/api/tco"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// tcoNarrationMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most query_tco_summary → answer (with
// optional retries). A hard ceiling of 8 is generous, matching
// aiCostForecastNarrationMaxIterations / aiBatteryHealthMaxIterations.
const tcoNarrationMaxIterations = 8

// tcoNarrationRequest is the JSON body shape this handler
// accepts. The shape mirrors the
// /api/v1/analytics/tco?vehicle_id= query-string contract —
// vehicle_id is the ONLY required field. Kept as a JSON body so
// the SPA can post from the same form state TrueCostPage already
// uses.
type tcoNarrationRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/analytics/tco/narrate.
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
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aitconar: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aitconar: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aitconar: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   tcoNarrationMaxIterations,
	}
}

// parseNarrationBody decodes + validates the JSON body.
// Pulled out so the validator-only test can exercise the same
// parsing without constructing a full handler with stub deps.
// The function writes a 400 on failure and returns the (req, ok)
// pair so the caller can early-return.
func parseNarrationBody(w http.ResponseWriter, r *http.Request) (*tcoNarrationRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req tcoNarrationRequest
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseNarrationBody(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures remain ordinary JSON 502s.
	if _, err := h.registry.For(r.Context(), tconarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai tco-narration: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, tconarration.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(tconarration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai tco-narration: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve again with subject and feature annotations for decorators.
	prov, err := h.registry.For(ctx, tconarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai tco-narration: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// TCO narration is non-conversational; the prompt forces the read-only tool
	// path and repeats the limiting assumptions from the deterministic envelope.
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

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/tco_summary.go. Kept in the same file as the
// handler so the wiring intent is local to the slice; mirrors
// the cost-forecast-narration slice's AICostForecaster pattern.
// ---------------------------------------------------------------------

// TCOSummarizer adapts the shared tco.ComputeTCOSummary helper for AI tools so
// narration stays grounded in the same deterministic envelope the chart renders.
// The constructor panics on nil DB to surface wiring bugs at boot.
type TCOSummarizer struct {
	db *database.DB
}

// NewTCOSummarizer constructs the adapter. Panics on a nil
// *database.DB so a wiring mistake surfaces at boot rather than
// as a nil-deref on first AI request.
func NewTCOSummarizer(db *database.DB) *TCOSummarizer {
	if db == nil {
		panic("aitconar: NewTCOSummarizer: nil *database.DB")
	}
	return &TCOSummarizer{db: db}
}

// SummarizeTCO implements lifetime.TCOSummarizer without recomputing TCO math.
// It reshapes the canonical summary for the LLM and attaches explicit caveats;
// currency remains blank because the baseline aggregate has no single currency.
func (a *TCOSummarizer) SummarizeTCO(ctx context.Context, vehicleID int64) (*lifetime.TCOSummary, error) {
	if vehicleID <= 0 {
		return nil, errors.New("aitconar: vehicle_id must be > 0")
	}

	summary, err := apitco.ComputeTCOSummary(ctx, a.db, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("aitconar: ComputeTCOSummary: %w", err)
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

// Compile-time assertion: TCOSummarizer satisfies
// lifetime.TCOSummarizer.
var _ lifetime.TCOSummarizer = (*TCOSummarizer)(nil)
