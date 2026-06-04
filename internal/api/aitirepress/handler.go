package aitirepress

// Handler for tire-pressure trend reasoning.
//
// LLM-backed POST /api/v1/ai/tire-pressure/trends/explain. The guard in
// ai_routes.go fails closed before this handler when AI mode or the feature
// toggle is off (ADR-015 §I6).
//
// The vehicle_id body is parsed before opening SSE so bad input returns JSON
// 400. The surface is opt-in and read-only; AI-only method fields stay out of
// the baseline /tire-pressure contract (ADR-015 §I3, §I9-I10).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	tirepressuretrendreasoning "github.com/ev-dev-labs/teslasync/internal/ai/strategies/tire-pressure-trend-reasoning"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/maintenance"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_tire_pressure_trend →
// answer (with optional retries). A hard ceiling of 8 is
// generous, matching aiCabinTemperatureImpactMaxIterations /
// aiCostForecastNarrationMaxIterations.
const maxIterations = 8

// windowDays is the trailing-window length
// the production adapter projects through signal.StateReader.
// 30 days mirrors the slice prompt's "30-day trend" framing AND
// the SPA's default preset on TirePressurePage.
const windowDays = 30

// minReadings is the minimum total
// TpmsPressure* emission count (across all four corners) the
// adapter requires before it lets the narrator quote a
// per-tire trend. Below this threshold has_enough_data flips
// false and the narrator says so plainly. The bound mirrors the
// chart's implicit threshold — fewer than ~20 TPMS readings
// across a 30-day window is too sparse to fit a meaningful
// linear trend (TPMS re-emits on the order of once per drive,
// sometimes only once per week for a parked vehicle).
const minReadings = 20

// Pressure thresholds in Pascals (SI). Mirror the SPA's
// TirePressurePage (web/src/features/vehicle-systems/pages/
// TirePressurePage.tsx L67-L71). 1 bar = 100_000 Pa,
// 1 psi ≈ 6894.757 Pa.
const (
	tirePressureSoftLowPa   = 200_000.0 // 2.0 bar
	tirePressureNormalMinPa = 250_000.0 // 2.5 bar
	tirePressureNormalMaxPa = 350_000.0 // 3.5 bar
	tirePressureSoftHighPa  = 400_000.0 // 4.0 bar
)

// tireOutsideTempSignal is the OutsideTemp signal the adapter
// projects alongside the four TpmsPressure* corners so the
// envelope can report the rolling outside-ambient summary the
// narrator uses to surface the seasonality / cold-weather
// correlation hint.
const tireOutsideTempSignal = "OutsideTemp"

// Signal → JSON field mappings for TPMS timeline / state projection.
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (e.g. front_left → frontLeft).
var tirePressureMappings = []signal.FieldMapping{
	{Signal: "TpmsPressureFl", Field: "front_left"},
	{Signal: "TpmsPressureFr", Field: "front_right"},
	{Signal: "TpmsPressureRl", Field: "rear_left"},
	{Signal: "TpmsPressureRr", Field: "rear_right"},
	{Signal: "TpmsLastSeenPressureTimeFl", Field: "last_seen_fl"},
	{Signal: "TpmsLastSeenPressureTimeFr", Field: "last_seen_fr"},
	{Signal: "TpmsLastSeenPressureTimeRl", Field: "last_seen_rl"},
	{Signal: "TpmsLastSeenPressureTimeRr", Field: "last_seen_rr"},
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// request is the JSON body shape this
// handler accepts. Mirrors the
// /api/v1/tire-pressure?vehicle_id= query-string contract —
// vehicle_id is required, no other params — kept as a JSON body
// so the SPA can post from the same form state the
// tire-pressure page already uses.
type request struct {
	VehicleID int64 `json:"vehicle_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/tire-pressure/trends/explain.
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
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aitirepress: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aitirepress: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aitirepress: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseTirePressureTrendBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub
// deps. The function writes a 400 on failure and returns the
// (req, ok) pair so the caller can early-return.
func parseTirePressureTrendBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
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
	return &req, true
}

// ServeHTTP implements [http.Handler]. Provider errors before SSE opens stay
// plain JSON; later failures are emitted as stream frames.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseTirePressureTrendBody(w, r)
	if !ok {
		return
	}

	if _, err := h.registry.For(r.Context(), tirepressuretrendreasoning.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai tire-pressure-trend-reasoning: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, tirepressuretrendreasoning.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(tirepressuretrendreasoning.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai tire-pressure-trend-reasoning: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, tirepressuretrendreasoning.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai tire-pressure-trend-reasoning: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Use a deterministic prompt with honest-method cues; this is a descriptive
	// aggregate, not a forecast.
	userMsg := fmt.Sprintf(
		"Narrate the recent 30-day tire-pressure trend for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_tire_pressure_trend with vehicle_id=%d to fetch the deterministic "+
			"tire-pressure trend envelope. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out "+
			"which tires are trending up, down, or stable, the most likely deterministic driver of "+
			"any deviation (cold-weather correlation if the OutsideTemp summary correlates, "+
			"all-tires-trending-together suggesting weather rather than puncture, slow-leak "+
			"signature if a single corner's rate is materially worse), and any actionable threshold "+
			"crossing. "+
			"ALWAYS surface the method honestly: this is a descriptive linear extrapolation across "+
			"the recent change-feed window, NOT a forecast or regression model. "+
			"Remember: you NEVER change the thresholds or invent rates — you EXPLAIN them. "+
			"If has_enough_data is false, say so plainly rather than inventing a slope, a likely "+
			"cause, or a per-tire status.",
		body.VehicleID, body.VehicleID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai tire-pressure-trend-reasoning: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/tire_pressure_trend.go. Kept in the same
// file as the handler so the wiring intent is local to the
// slice; mirrors the cabin-temperature-impact-narrative slice's
// AITemperatureImpactSource pattern.
// ---------------------------------------------------------------------

// AITirePressureTrendSource is the production
// maintenance.TirePressureTrendSource. It runs the SAME
// signal.StateReader.Timeline projection that backs the canonical
// GET /api/v1/tire-pressure handler so the AI narration is
// grounded in the SAME numbers the four-corner gauges on
// /tire-pressure render. No write path is invoked.
//
// The struct holds a signal.StateReader; the constructor panics
// on a nil so a wiring bug surfaces at boot.
type AITirePressureTrendSource struct {
	state signal.StateReader
}

// NewAITirePressureTrendSource constructs the adapter. Panics on
// a nil signal.StateReader so a wiring mistake surfaces at boot
// rather than as a nil-deref on first AI request.
func NewAITirePressureTrendSource(state signal.StateReader) *AITirePressureTrendSource {
	if state == nil {
		panic("aitirepress: NewAITirePressureTrendSource: nil signal.StateReader")
	}
	return &AITirePressureTrendSource{state: state}
}

// QueryTirePressureTrend implements
// maintenance.TirePressureTrendSource. Composes the SAME
// signal.StateReader.Timeline projection the canonical
// TirePressureHandler.List uses, with two extras:
//
//   - The OutsideTemp signal is projected alongside the four
//     TpmsPressure* corners so the rolling outside-ambient
//     summary is available for the cold-weather correlation
//     hint.
//   - Per-corner aggregates (latest, average, min, max,
//     rate_pa_per_day) are computed in Go from the forward-
//     folded TimelineRow slice — the SAME data the chart
//     consumes. Status is assigned via the SAME thresholds the
//     SPA uses on TirePressurePage (mirrored above as the
//     tirePressureSoftLowPa / NormalMinPa / NormalMaxPa /
//     SoftHighPa constants).
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing
// output into the typed [maintenance.TirePressureTrend] envelope the
// LLM can quote. Sample-size + has_enough_data flagging,
// deterministic likely-cause hints, and insight generation are
// added on top — they are pure-functional derivations of the
// per-corner aggregate.
func (a *AITirePressureTrendSource) QueryTirePressureTrend(ctx context.Context, vehicleID int64) (*maintenance.TirePressureTrend, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai tire-pressure-trend-reasoning: vehicle_id must be > 0")
	}

	to := time.Now()
	from := to.AddDate(0, 0, -windowDays)

	// Chart mode keeps one row per emission across TPMS corners and OutsideTemp.
	mappings := append([]signal.FieldMapping(nil), tirePressureMappings...)
	mappings = append(mappings, signal.FieldMapping{Signal: tireOutsideTempSignal, Field: "outside_temp_c"})

	rows, err := a.state.Timeline(ctx, vehicleID, mappings, from, to, signal.TimelineOptions{})
	if err != nil {
		return nil, fmt.Errorf("api ai tire-pressure-trend-reasoning: timeline query: %w", err)
	}

	envelope := &maintenance.TirePressureTrend{
		VehicleID:           vehicleID,
		WindowDays:          windowDays,
		MinRequiredReadings: minReadings,
		Method:              "Linear least-squares slope across the 30-day TpmsPressure* change-feed window per corner; corner status is assigned by the deterministic soft-low / normal-min / normal-max / soft-high thresholds; outside-ambient summary is the rolling 30-day average / min / max of the OutsideTemp signal.",
		Assumptions: []string{
			"Per-corner trend is a descriptive linear slope across the recent change-feed window; it is NOT a forecast or regression model.",
			"Outside ambient correlation is a heuristic: when all four corners trend down together AND the rolling average outside temperature dropped materially across the same window, seasonal contraction is the most likely deterministic driver rather than a puncture.",
			fmt.Sprintf("Minimum total TpmsPressure emission count across all four corners for a meaningful narrative is %d readings; below this threshold has_enough_data is false.", minReadings),
		},
		Thresholds: maintenance.TirePressureThresholds{
			SoftLowPa:   tirePressureSoftLowPa,
			NormalMinPa: tirePressureNormalMinPa,
			NormalMaxPa: tirePressureNormalMaxPa,
			SoftHighPa:  tirePressureSoftHighPa,
		},
		Tires:        []maintenance.TirePressureCorner{},
		LikelyCauses: []string{},
		Insights:     []string{},
	}

	type cornerSpec struct {
		field string
		label string
		pos   string
	}
	corners := []cornerSpec{
		{field: "front_left", label: "Front Left", pos: "fl"},
		{field: "front_right", label: "Front Right", pos: "fr"},
		{field: "rear_left", label: "Rear Left", pos: "rl"},
		{field: "rear_right", label: "Rear Right", pos: "rr"},
	}

	totalReadings := 0
	cornerByPos := make(map[string]*maintenance.TirePressureCorner, 4)
	for _, c := range corners {
		series := extractCornerSeries(rows, c.field)
		summary := summariseCorner(c.pos, c.label, series)
		envelope.Tires = append(envelope.Tires, summary)
		totalReadings += summary.ReadingCount
		// Point at the slice element, not the loop copy, so later classification mutates the envelope.
		cornerByPos[c.pos] = &envelope.Tires[len(envelope.Tires)-1]
	}

	envelope.SampleSize = totalReadings
	envelope.HasEnoughData = totalReadings >= minReadings

	// Outside-temperature summary across the same window.
	outside := extractOutsideTempSummary(rows)
	if outside != nil {
		envelope.OutsideTempSummary = outside
	}

	// If has_enough_data is false the narrator must NOT quote
	// per-tire status / rate / likely-cause attributions —
	// clear them so the LLM cannot hallucinate from leftovers.
	if !envelope.HasEnoughData {
		for i := range envelope.Tires {
			envelope.Tires[i].Status = ""
			envelope.Tires[i].RatePaPerDay = 0
			envelope.Tires[i].DaysUntilSoftLowEstimate = nil
		}
		envelope.LikelyCauses = []string{}
		envelope.Insights = []string{}
		return envelope, nil
	}

	envelope.LikelyCauses = buildTirePressureLikelyCauses(envelope.Tires, outside)
	envelope.Insights = buildTirePressureInsights(envelope.Tires, envelope.Thresholds)

	// Stable-order causes / insights for deterministic eval.
	sort.Strings(envelope.LikelyCauses)
	sort.Strings(envelope.Insights)

	return envelope, nil
}

// timelinePoint is the scalar (timestamp, value-in-Pa) record
// the per-corner aggregator works on. The Pa value is
// normalised through tireRawToPa so heterogeneous units (Pa,
// kPa, psi, bar) all collapse to a single SI canonical scalar
// — mirrors the SPA's normaliseTpmsToPa band-aid in
// TirePressurePage.tsx (L97-L103).
type timelinePoint struct {
	ts time.Time
	pa float64
}

// extractCornerSeries pulls the per-corner timeline points out
// of the forward-folded TimelineRow slice for the named output
// field. Rows whose forward-folded value is nil / zero / NaN
// are skipped — those would inject phantom zero-pressure points
// into the regression.
func extractCornerSeries(rows []signal.TimelineRow, field string) []timelinePoint {
	out := make([]timelinePoint, 0, len(rows))
	var lastVal float64
	var haveLast bool
	for _, row := range rows {
		v, ok := row.Fields[field]
		if !ok || v == nil {
			continue
		}
		raw, ok := signalValueToFloat(v)
		if !ok {
			continue
		}
		pa := tireRawToPa(raw)
		if pa <= 0 || math.IsNaN(pa) || math.IsInf(pa, 0) {
			continue
		}
		// De-duplicate consecutive identical forward-folded
		// values: the TimelineRow stream is forward-folded
		// across all 5 projected fields, so every OutsideTemp
		// emission produces a row that re-states the most
		// recently observed TPMS values. Without this filter
		// the per-corner sample size is inflated by every
		// OutsideTemp emission and the slope is dragged
		// toward zero.
		if haveLast && pa == lastVal {
			continue
		}
		lastVal = pa
		haveLast = true
		out = append(out, timelinePoint{ts: row.Timestamp, pa: pa})
	}
	return out
}

// extractOutsideTempSummary pulls the rolling outside-ambient
// summary out of the forward-folded TimelineRow slice.
// Returns nil when the OutsideTemp signal has no readings in
// the window (the narrator must not invent a correlation).
func extractOutsideTempSummary(rows []signal.TimelineRow) *maintenance.TireOutsideTempSummary {
	count := 0
	var sum, minV, maxV float64
	var lastVal float64
	var haveLast bool
	for _, row := range rows {
		v, ok := row.Fields["outside_temp_c"]
		if !ok || v == nil {
			continue
		}
		raw, ok := signalValueToFloat(v)
		if !ok {
			continue
		}
		if math.IsNaN(raw) || math.IsInf(raw, 0) {
			continue
		}
		// De-duplicate consecutive identical forward-folded
		// values for the same reason as the corner series:
		// the row stream is forward-folded across all 5
		// fields.
		if haveLast && raw == lastVal {
			continue
		}
		lastVal = raw
		haveLast = true
		if count == 0 {
			minV, maxV = raw, raw
		} else {
			if raw < minV {
				minV = raw
			}
			if raw > maxV {
				maxV = raw
			}
		}
		sum += raw
		count++
	}
	if count == 0 {
		return nil
	}
	return &maintenance.TireOutsideTempSummary{
		ReadingCount: count,
		AvgTempC:     math.Round((sum/float64(count))*10) / 10,
		MinTempC:     math.Round(minV*10) / 10,
		MaxTempC:     math.Round(maxV*10) / 10,
	}
}

// summariseCorner computes the per-corner aggregate and threshold status.
// RatePaPerDay is a least-squares Pa/day slope; fewer than two points produce
// a zero slope and no soft-low estimate.
func summariseCorner(pos, label string, series []timelinePoint) maintenance.TirePressureCorner {
	out := maintenance.TirePressureCorner{
		Position:                 pos,
		Label:                    label,
		ReadingCount:             len(series),
		DaysUntilSoftLowEstimate: nil,
	}
	if len(series) == 0 {
		return out
	}
	sum := 0.0
	minV, maxV := series[0].pa, series[0].pa
	for _, p := range series {
		sum += p.pa
		if p.pa < minV {
			minV = p.pa
		}
		if p.pa > maxV {
			maxV = p.pa
		}
	}
	out.LatestPa = math.Round(series[len(series)-1].pa)
	out.AveragePa = math.Round(sum / float64(len(series)))
	out.MinPa = math.Round(minV)
	out.MaxPa = math.Round(maxV)
	out.RatePaPerDay = math.Round(linearSlopePaPerDay(series))
	out.Status = classifyTirePressureStatus(out.LatestPa)
	if out.RatePaPerDay < 0 && out.LatestPa > tirePressureSoftLowPa {
		// Negative slopes estimate days until the soft-low threshold.
		days := (out.LatestPa - tirePressureSoftLowPa) / -out.RatePaPerDay
		if days > 0 && !math.IsNaN(days) && !math.IsInf(days, 0) {
			d := int(math.Round(days))
			out.DaysUntilSoftLowEstimate = &d
		}
	}
	return out
}

// linearSlopePaPerDay returns the least-squares slope of the
// series in Pa per day. Returns 0 when fewer than 2 points are
// available, or when the time-span across the series is
// degenerate (less than 1 second).
func linearSlopePaPerDay(series []timelinePoint) float64 {
	n := len(series)
	if n < 2 {
		return 0
	}
	t0 := series[0].ts
	span := series[n-1].ts.Sub(t0).Seconds()
	if span < 1 {
		return 0
	}
	const secondsPerDay = 86400.0
	var sumX, sumY, sumXY, sumX2 float64
	for _, p := range series {
		x := p.ts.Sub(t0).Seconds() / secondsPerDay
		y := p.pa
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}
	nf := float64(n)
	denom := nf*sumX2 - sumX*sumX
	if denom == 0 {
		return 0
	}
	return (nf*sumXY - sumX*sumY) / denom
}

// classifyTirePressureStatus assigns a per-corner status from
// the latest observed Pa value. The classification mirrors the
// SPA's TirePressurePage status thresholds — a future change to
// either side MUST update both.
func classifyTirePressureStatus(latestPa float64) string {
	switch {
	case latestPa <= 0:
		return ""
	case latestPa < tirePressureSoftLowPa:
		return "critical"
	case latestPa < tirePressureNormalMinPa:
		return "low"
	case latestPa > tirePressureSoftHighPa:
		return "critical"
	case latestPa > tirePressureNormalMaxPa:
		return "high"
	default:
		return "normal"
	}
}

// tireRawToPa coerces a raw TPMS value to Pa. Mirrors the
// SPA's normaliseTpmsToPa band-aid in TirePressurePage.tsx
// (L97-L103) so the AI narration agrees with the gauge
// readings even when the vehicle's unit history is missing on
// the codec side. Until the cross-cutting fix lands the
// adapter detects the three plausible source units by value
// range and normalises.
func tireRawToPa(raw float64) float64 {
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return 0
	}
	switch {
	case raw >= 50_000:
		return raw // already Pa
	case raw >= 100:
		return raw * 1_000 // kPa
	case raw >= 10:
		return raw * 6_894.757 // psi
	default:
		return raw * 100_000 // bar
	}
}

// signalValueToFloat coerces a signal.SignalValue (which is
// `any` at the type level) to a float64 the aggregator can
// consume. Returns (0, false) when the value cannot be
// represented as a number.
func signalValueToFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

// buildTirePressureLikelyCauses generates the 0-2 deterministic
// short likely-cause hints the narrator may quote.
//
// The hints are PURE derivations of the per-corner aggregate
// + the rolling outside-ambient summary; they never invent
// numbers. Two recognised hint families:
//
//   - Cold-weather correlation: ALL four corners are losing
//     pressure (RatePaPerDay < 0) AND the rolling average
//     outside temperature is < 5 °C. Seasonal contraction is
//     the most likely deterministic driver.
//   - Slow-leak signature: ONE corner is losing pressure at a
//     rate at least 2× the average across the other three
//     corners. Single-corner anomaly suggests a puncture
//     rather than weather.
func buildTirePressureLikelyCauses(tires []maintenance.TirePressureCorner, outside *maintenance.TireOutsideTempSummary) []string {
	if len(tires) == 0 {
		return []string{}
	}
	out := make([]string, 0, 2)

	// All four tires trending down in cold air implies seasonal contraction.
	allDown := true
	for _, t := range tires {
		if t.RatePaPerDay >= 0 {
			allDown = false
			break
		}
	}
	if allDown && outside != nil && outside.AvgTempC < 5 {
		out = append(out,
			fmt.Sprintf("All four tires are losing pressure together while the rolling average outside temperature is %.1f°C — most likely deterministic driver is seasonal contraction (cold-weather correlation), NOT a puncture.", outside.AvgTempC))
	}

	// Single-corner outliers imply a slow-leak signature.
	if leak, label := detectSingleCornerLeak(tires); leak {
		out = append(out,
			fmt.Sprintf("The %s corner is losing pressure materially faster than the other three — single-corner anomaly fits a slow-leak signature, NOT seasonal contraction.", label))
	}

	return out
}

// detectSingleCornerLeak returns (true, label) iff one corner's
// negative rate is at least 2× the average of the other three
// corners' negative rates. Returns (false, "") when the data
// does not fit the single-corner-anomaly pattern.
func detectSingleCornerLeak(tires []maintenance.TirePressureCorner) (bool, string) {
	if len(tires) < 4 {
		return false, ""
	}
	worstIdx := -1
	for i, t := range tires {
		if t.RatePaPerDay >= 0 {
			continue
		}
		if worstIdx < 0 || t.RatePaPerDay < tires[worstIdx].RatePaPerDay {
			worstIdx = i
		}
	}
	if worstIdx < 0 {
		return false, ""
	}
	worstRate := -tires[worstIdx].RatePaPerDay
	if worstRate <= 0 {
		return false, ""
	}
	otherSum := 0.0
	otherCount := 0
	for i, t := range tires {
		if i == worstIdx {
			continue
		}
		if t.RatePaPerDay < 0 {
			otherSum += -t.RatePaPerDay
			otherCount++
		}
	}
	otherAvg := 0.0
	if otherCount > 0 {
		otherAvg = otherSum / float64(otherCount)
	}
	if worstRate >= 2*otherAvg && worstRate-otherAvg >= 200 {
		// 200 Pa/day floor avoids classifying a 0.1 Pa/day
		// outlier on otherwise stable tires as a "leak".
		return true, tires[worstIdx].Label
	}
	return false, ""
}

// buildTirePressureInsights generates 0-3 deterministic short
// insight strings the narrator may quote. The insights are
// pure derivations of the per-corner aggregate + the threshold
// band; they never invent numbers.
func buildTirePressureInsights(tires []maintenance.TirePressureCorner, _ maintenance.TirePressureThresholds) []string {
	if len(tires) == 0 {
		return []string{}
	}
	out := make([]string, 0, 3)

	// Threshold crossings are the actionable insights.
	for _, t := range tires {
		if t.LatestPa > 0 && t.LatestPa < tirePressureSoftLowPa {
			out = append(out,
				fmt.Sprintf("%s is below the soft-low threshold (%.0f Pa current vs %.0f Pa soft-low) and needs immediate attention.",
					t.Label, t.LatestPa, tirePressureSoftLowPa))
		}
		if t.LatestPa > tirePressureSoftHighPa {
			out = append(out,
				fmt.Sprintf("%s is above the soft-high threshold (%.0f Pa current vs %.0f Pa soft-high) and needs to be released to a safe pressure.",
					t.Label, t.LatestPa, tirePressureSoftHighPa))
		}
	}

	// Surface the soonest finite soft-low estimate once.
	soonest := -1
	for i, t := range tires {
		if t.DaysUntilSoftLowEstimate == nil {
			continue
		}
		if soonest < 0 || *t.DaysUntilSoftLowEstimate < *tires[soonest].DaysUntilSoftLowEstimate {
			soonest = i
		}
	}
	if soonest >= 0 && tires[soonest].DaysUntilSoftLowEstimate != nil {
		out = append(out,
			fmt.Sprintf("At the current rate %s would cross the soft-low threshold in about %d day(s) — descriptive linear projection, NOT a forecast.",
				tires[soonest].Label, *tires[soonest].DaysUntilSoftLowEstimate))
	}

	return out
}

// Compile-time assertion: AITirePressureTrendSource satisfies
// maintenance.TirePressureTrendSource.
var _ maintenance.TirePressureTrendSource = (*AITirePressureTrendSource)(nil)
