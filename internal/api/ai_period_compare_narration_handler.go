package api

// Phase-50 / 0040 — X1 Period compare narration.
//
// ai_period_compare_narration_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/analytics/period-compare/narrate.
// The flow mirrors ai_cost_forecast_narration_handler.go (same
// dispatch+stream loop, no persistence — one-shot read-only
// narration):
//
//	URL  /api/v1/ai/analytics/period-compare/narrate
//	  ↓
//	resolve provider via *provider.Registry.For("period-compare-narration")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("period-compare-narration", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id + optional days_a + optional days_b)
// is parsed BEFORE opening the SSE stream so a malformed input
// surfaces as a plain JSON 400 (rather than a streamed error
// frame the SPA's QueryError will struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /period-compare page
//     (and its alias /analytics/compare) — vehicle/period
//     selectors, the disambiguation banner, six MetricCards
//     (distance, drives, energy, efficiency, cost, CO2), the
//     side-by-side BarChart, the comparison DataTable, and the
//     deterministic insights bullets — hitting GET
//     /api/v1/analytics/period-stats — is unchanged. This handler
//     is an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("period-compare-narration").
//   - I9 redaction:       PolicyPeriodCompareNarration (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice. The tool envelope's
//     extra per-metric delta block lives in the AI-only typed
//     [forecast.PeriodCompare] envelope, not on the baseline
//     /analytics/period-stats response.

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
	apiperiod "github.com/ev-dev-labs/teslasync/internal/api/periodstats"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// aiPeriodCompareNarrationMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_period_compare → answer
// (with optional retries). A hard ceiling of 8 is generous,
// matching aiCostForecastNarrationMaxIterations.
const aiPeriodCompareNarrationMaxIterations = 8

// aiPeriodCompareNarrationDefaultDaysA / DaysB are the default
// trailing-day windows when the request body omits them. Mirrors
// the SPA's PeriodComparePage selector defaults (Period A=30d,
// Period B=90d). Kept as named constants so a future tuning lives
// in one place rather than duplicated across the parser + the
// tool's Execute default.
const aiPeriodCompareNarrationDefaultDaysA = 30
const aiPeriodCompareNarrationDefaultDaysB = 90

// aiPeriodCompareNarrationMaxDays is the upper bound on the
// trailing-day window. Mirrors the canonical handler's lack of an
// explicit cap (the SPA selectors top out at 365 + a "all time"
// option which sends days=0); 3650 ≈ 10 years caps an LLM
// nonsense value before any SQL runs.
const aiPeriodCompareNarrationMaxDays = 3650

// aiPeriodCompareNarrationRequest is the JSON body shape this
// handler accepts. The shape mirrors the
// /api/v1/analytics/period-stats?vehicle_id=&days= query-string
// contract — vehicle_id is required, days_a / days_b are optional
// — kept as a JSON body so the SPA can post from the same form
// state the period-compare page already uses.
type aiPeriodCompareNarrationRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	DaysA     int   `json:"days_a,omitempty"`
	DaysB     int   `json:"days_b,omitempty"`
}

// AIPeriodCompareNarrationHandler is the HTTP handler for
// POST /api/v1/ai/analytics/period-compare/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIPeriodCompareNarrationHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIPeriodCompareNarrationHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_period_compare (registered by
//	forecast.RegisterPeriodCompareNarrationTools in router.go).
//
// strat:      the period-compare-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIPeriodCompareNarrationHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIPeriodCompareNarrationHandler {
	switch {
	case registry == nil:
		panic("api: NewAIPeriodCompareNarrationHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIPeriodCompareNarrationHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIPeriodCompareNarrationHandler: nil strategy.Strategy")
	}
	return &AIPeriodCompareNarrationHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiPeriodCompareNarrationMaxIterations,
	}
}

// parsePeriodCompareNarrationBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub
// deps. The function writes a 400 on failure and returns the
// (req, ok) pair so the caller can early-return.
//
// The days_a / days_b fields default to
// aiPeriodCompareNarrationDefaultDaysA / DaysB when omitted (or
// zero AND omitted; an explicit "0" means "all time" — mirrored
// by the underlying ComputePeriodStats helper that drops the
// date filter when days <= 0). The bound is [0,
// aiPeriodCompareNarrationMaxDays] so an out-of-range value
// lands as a 400 before any SSE stream is opened.
//
// Note on zero handling: because the SPA selectors include a
// "0 = all time" value, we cannot use raw `if d == 0 { default }`
// without a presence indicator. We use a custom unmarshaller-
// backed approach: if the field is OMITTED entirely (raw bytes
// don't include "days_a"), default to 30; if explicitly set to
// 0, treat as "all time" and pass through.
func parsePeriodCompareNarrationBody(w http.ResponseWriter, r *http.Request) (*aiPeriodCompareNarrationRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()

	// Decode into a typed-presence map first so we can tell
	// "field omitted entirely" from "field explicitly set to 0".
	// "all time" is a real selector value the SPA sends.
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}

	req := aiPeriodCompareNarrationRequest{
		DaysA: aiPeriodCompareNarrationDefaultDaysA,
		DaysB: aiPeriodCompareNarrationDefaultDaysB,
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
	// Reject any other keys — DisallowUnknownFields only kicks
	// in when decoding into a typed struct; with a map[string]
	// json.RawMessage we have to manually check.
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
	if req.DaysA < 0 || req.DaysA > aiPeriodCompareNarrationMaxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days_a must be between 0 and %d", aiPeriodCompareNarrationMaxDays))
		return nil, false
	}
	if req.DaysB < 0 || req.DaysB > aiPeriodCompareNarrationMaxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days_b must be between 0 and %d", aiPeriodCompareNarrationMaxDays))
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIPeriodCompareNarrationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, periodcomparenarration.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(periodcomparenarration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai period-compare-narration: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	// (now-annotated) context.
	prov, err := h.registry.For(ctx, periodcomparenarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai period-compare-narration: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Period-compare narration
	// is NOT conversational here — there is no chat history.
	// We hand the LLM a deterministic prompt that asks it to
	// call the single read-only tool in scope and narrate the
	// result, with explicit honest-direction cues so the
	// narration is keyed to the percent_change SIGN.
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

	// 8) Run the dispatcher.
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

// Compile-time assertion: AIPeriodCompareNarrationHandler
// satisfies http.Handler.
var _ http.Handler = (*AIPeriodCompareNarrationHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/period_compare.go. Kept in the same file as
// the handler so the wiring intent is local to the slice;
// mirrors the cost-forecast-narration slice's AICostForecaster
// pattern.
// ---------------------------------------------------------------------

// AIPeriodCompareSource is the production forecast.PeriodComparator.
// It delegates to the SHARED apiperiod.ComputePeriodStats helper that
// also backs the canonical GET /api/v1/analytics/period-stats
// handler so the AI narration is grounded in the SAME
// deterministic aggregate the chart on /period-compare renders.
// No new SQL is added by this slice.
//
// Refactoring the existing PeriodStatsHandler.Get to pull its
// core into the package-level ComputePeriodStats helper (and
// having both call sites use it) was the deliberate choice over
// duplicating the SQL/math here.
//
// The struct holds *database.DB; the constructor panics on a
// nil so a wiring bug surfaces at boot.
type AIPeriodCompareSource struct {
	db *database.DB
}

// NewAIPeriodCompareSource constructs the adapter. Panics on a
// nil *database.DB so a wiring mistake surfaces at boot rather
// than as a nil-deref on first AI request.
func NewAIPeriodCompareSource(db *database.DB) *AIPeriodCompareSource {
	if db == nil {
		panic("api: NewAIPeriodCompareSource: nil *database.DB")
	}
	return &AIPeriodCompareSource{db: db}
}

// ComparePeriods implements forecast.PeriodComparator. Composes the
// SAME apiperiod.ComputePeriodStats helper *periodstats.Handler.Get uses
// (called once per period window) so the returned envelope is
// numerically identical (modulo rounding) to what GET
// /api/v1/analytics/period-stats produces — the AI surface is
// grounded in the SAME deterministic model the chart renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing
// output into the typed [forecast.PeriodCompare] envelope the LLM
// can quote, and computes the per-metric deltas via the shared
// forecast.ComputePeriodCompareDeltas helper.
func (a *AIPeriodCompareSource) ComparePeriods(ctx context.Context, vehicleID int64, daysA, daysB int) (*forecast.PeriodCompare, error) {
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

// Compile-time assertion: AIPeriodCompareSource satisfies
// forecast.PeriodComparator.
var _ forecast.PeriodComparator = (*AIPeriodCompareSource)(nil)
