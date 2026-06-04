package aiperiodcmp

// Handler for period compare narration.
//
// Implements POST /api/v1/ai/analytics/period-compare/narrate as a read-only SSE narrator.
// The route is guard-wrapped for ADR-015 off-mode behavior; the deterministic period-stats endpoint remains the baseline.
// The JSON body is validated before streaming so malformed input returns a plain JSON 400.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	periodcomparenarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/period-compare-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	apiperiod "github.com/ev-dev-labs/teslasync/internal/api/periodstats"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// maxIterations bounds the read-only tool loop; 8 matches cost-forecast narration.
const maxIterations = 8

// Defaults mirror the PeriodComparePage selectors.
const defaultDaysA = 30
const defaultDaysB = 90

// maxDays caps LLM nonsense values before any SQL runs.
const maxDays = 3650

// request mirrors /api/v1/analytics/period-stats but travels as a JSON body.
type request struct {
	VehicleID int64 `json:"vehicle_id"`
	DaysA     int   `json:"days_a,omitempty"`
	DaysB     int   `json:"days_b,omitempty"`
}

// Handler serves period-compare narration and is safe for concurrent use.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler and panics on missing boot wiring.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aiperiodcmp: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aiperiodcmp: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aiperiodcmp: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parsePeriodCompareNarrationBody validates the body before SSE starts.
// Omitted days fields use defaults; an explicit 0 means "all time," matching the SPA selector.
func parsePeriodCompareNarrationBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()

	// Decode through RawMessage so omitted days and explicit 0 remain distinguishable.
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}

	req := request{
		DaysA: defaultDaysA,
		DaysB: defaultDaysB,
	}

	if v, ok := raw["vehicle_id"]; ok {
		if err := json.Unmarshal(v, &req.VehicleID); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid vehicle_id: %v", err))
			return nil, false
		}
	}
	if v, ok := raw["days_a"]; ok {
		if err := json.Unmarshal(v, &req.DaysA); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid days_a: %v", err))
			return nil, false
		}
	}
	if v, ok := raw["days_b"]; ok {
		if err := json.Unmarshal(v, &req.DaysB); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid days_b: %v", err))
			return nil, false
		}
	}
	// DisallowUnknownFields does not protect map decodes, so reject unknown keys manually.
	for k := range raw {
		switch k {
		case "vehicle_id", "days_a", "days_b":
			// expected
		default:
			writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown field %q", k))
			return nil, false
		}
	}

	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	if req.DaysA < 0 || req.DaysA > maxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days_a must be between 0 and %d", maxDays))
		return nil, false
	}
	if req.DaysB < 0 || req.DaysB > maxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days_b must be between 0 and %d", maxDays))
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
	// 1) Parse + validate the JSON body.
	body, ok := parsePeriodCompareNarrationBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), periodcomparenarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai period-compare-narration: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, periodcomparenarration.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(periodcomparenarration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai period-compare-narration: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, periodcomparenarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai period-compare-narration: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Build a deterministic, non-conversational prompt keyed to the delta sign.
	userMsg := fmt.Sprintf(
		"Narrate the period comparison for vehicle %d between Period A (last %d days) and Period B (last %d days). "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_period_compare with vehicle_id=%d, days_a=%d, days_b=%d to fetch the deterministic "+
			"per-period stats + per-metric deltas. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out the one or "+
			"two metrics whose percent_change moved most, with directional phrasing keyed to the percent_change "+
			"SIGN (positive = Period A higher than Period B, negative = Period A lower). "+
			"Remember: you NEVER change the deltas or invent numbers — you EXPLAIN them. "+
			"If either window has zero drives (period_a.total_drives == 0 OR period_b.total_drives == 0) say so "+
			"plainly rather than inventing a percent change for a zero baseline. "+
			"Cost figures are best-effort and may mix currencies if the user has multi-currency charging "+
			"sessions; surface that caveat when total_cost is non-zero.",
		body.VehicleID, body.DaysA, body.DaysB, body.VehicleID, body.DaysA, body.DaysB,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("days_a", body.DaysA).
			Int("days_b", body.DaysB).
			Msg("ai period-compare-narration: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/period_compare.go. Kept in the same file as
// the handler so the wiring intent is local to the slice;
// mirrors the cost-forecast-narration slice's AICostForecaster
// pattern.
// ---------------------------------------------------------------------

// PeriodCompareSource reuses ComputePeriodStats so AI narration matches the deterministic chart data.
type PeriodCompareSource struct {
	db *database.DB
}

// NewPeriodCompareSource panics on nil DB so wiring bugs fail at boot.
func NewPeriodCompareSource(db *database.DB) *PeriodCompareSource {
	if db == nil {
		panic("aiperiodcmp: NewPeriodCompareSource: nil *database.DB")
	}
	return &PeriodCompareSource{db: db}
}

// ComparePeriods composes the same ComputePeriodStats helper used by the baseline endpoint.
// It only reshapes results and computes shared deltas for the AI envelope.
func (a *PeriodCompareSource) ComparePeriods(ctx context.Context, vehicleID int64, daysA, daysB int) (*forecast.PeriodCompare, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai period-compare-narration: vehicle_id must be > 0")
	}

	statsA, err := apiperiod.ComputePeriodStats(ctx, a.db, vehicleID, daysA)
	if err != nil {
		return nil, fmt.Errorf("api ai period-compare-narration: ComputePeriodStats(period_a): %w", err)
	}
	statsB, err := apiperiod.ComputePeriodStats(ctx, a.db, vehicleID, daysB)
	if err != nil {
		return nil, fmt.Errorf("api ai period-compare-narration: ComputePeriodStats(period_b): %w", err)
	}

	periodA := forecast.PeriodComparePeriod{
		Days:                 daysA,
		TotalDistanceKm:      statsA.TotalDistance,
		TotalDrives:          statsA.TotalDrives,
		EnergyUsedKWh:        statsA.EnergyUsed,
		AvgEfficiencyWhPerKm: statsA.AvgEfficiency,
		TotalCost:            statsA.TotalCost,
		CO2SavedKg:           statsA.CO2Saved,
	}
	periodB := forecast.PeriodComparePeriod{
		Days:                 daysB,
		TotalDistanceKm:      statsB.TotalDistance,
		TotalDrives:          statsB.TotalDrives,
		EnergyUsedKWh:        statsB.EnergyUsed,
		AvgEfficiencyWhPerKm: statsB.AvgEfficiency,
		TotalCost:            statsB.TotalCost,
		CO2SavedKg:           statsB.CO2Saved,
	}

	return &forecast.PeriodCompare{
		VehicleID: vehicleID,
		PeriodA:   periodA,
		PeriodB:   periodB,
		Deltas:    forecast.ComputePeriodCompareDeltas(periodA, periodB),
	}, nil
}

// Compile-time assertion: PeriodCompareSource satisfies
// forecast.PeriodComparator.
var _ forecast.PeriodComparator = (*PeriodCompareSource)(nil)

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}
