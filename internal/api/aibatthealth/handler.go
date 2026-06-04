package aibatthealth

// Battery health forecast narrative.
//
// Serves the opt-in SSE narrator at POST /api/v1/ai/battery/health/narrate.
// The route stays behind guard.Wrap("battery-health-forecast-narrative") so
// off-mode users keep the deterministic battery-health surface unchanged
// (ADR-015 §I3, §I6).
//
// The JSON body is parsed before opening SSE so malformed requests return a
// plain JSON 400 instead of a streamed error frame.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	batteryhealthforecastnarrative "github.com/ev-dev-labs/teslasync/internal/ai/strategies/battery-health-forecast-narrative"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/predict"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// maxIterations bounds the dispatcher's tool-loop.
// The strategy is at most query_battery_health_forecast → answer
// (with optional retries). A hard ceiling of 8 is generous, matching
// aiSmartChargeScheduleMaxIterations / aiTripPlannerLLMAgentMaxIterations.
const maxIterations = 8

// narrateRequest is the JSON body shape this handler
// accepts. The minimal shape mirrors the
// /api/v1/analytics/battery-degradation query-string contract —
// vehicle_id is the only required field — kept as a JSON body so
// the SPA can post from the same form state the digest narrator
// uses.
type narrateRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/battery/health/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once at
// boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_battery_health_forecast (registered by
//	predict.RegisterBatteryHealthForecastNarrativeTools in router.go).
//
// strat:      the battery-health-forecast-narrative Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aibatthealth: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aibatthealth: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aibatthealth: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseBatteryHealthNarrateBody decodes + validates the JSON body.
// Pulled out so the validator-only test can exercise the same
// parsing without constructing a full handler with stub deps. The
// function writes a 400 on failure and returns the (req, ok) pair
// so the caller can early-return.
func parseBatteryHealthNarrateBody(w http.ResponseWriter, r *http.Request) (*narrateRequest, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req narrateRequest
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
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseBatteryHealthNarrateBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), batteryhealthforecastnarrative.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai battery-health-forecast-narrative: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, batteryhealthforecastnarrative.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(batteryhealthforecastnarrative.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai battery-health-forecast-narrative: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, batteryhealthforecastnarrative.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai battery-health-forecast-narrative: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Battery-health narration is
	// NOT conversational here — there is no chat history. We hand
	// the LLM a deterministic prompt that asks it to call the
	// single read-only tool in scope and narrate the result.
	userMsg := fmt.Sprintf(
		"Narrate the battery-health forecast for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_battery_health_forecast with vehicle_id=%d to fetch the deterministic "+
			"forecast envelope. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out "+
			"current_health_pct, degradation_rate_pct_per_year, projected_80_pct_date, stress_level, "+
			"and the dominant entries in charging_habits / risk_factors. "+
			"Remember: you NEVER change the forecast or invent numbers — you EXPLAIN it. "+
			"If has_enough_data is false, say so plainly rather than inventing a slope or projected date.",
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
			Msg("ai battery-health-forecast-narrative: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// denyAllConfirm is the dispatcher's user-confirm hook. Battery-health narration
// declares only a read-only tool, so this is defence-in-depth against future
// strategy edits accidentally adding a mutating tool.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/battery_health_forecast.go. Kept in the same
// file as the handler so the wiring intent is local to the slice;
// mirrors the smart-charge-schedule-suggestion slice's
// AIChargeScheduleComputer pattern.
// ---------------------------------------------------------------------

// AIBatteryHealthForecaster is the production
// predict.BatteryHealthForecaster. It delegates to the same
// package-level helpers (synthesizeBatterySnapshots,
// predictDegradation, computeRiskFactors, lookupVehicleCapacityWh)
// that back the deterministic GET /api/v1/analytics/battery-degradation
// and GET /api/v1/analytics/battery-health handlers so the AI
// narration is grounded in the SAME deterministic forecast model
// the chart on /battery renders.
//
// The struct holds the same three fields *BatteryDegradationHandler
// holds; the constructor panics on a nil signal.StateReader so a
// wiring bug surfaces at boot.
type AIBatteryHealthForecaster struct {
	db              *database.DB
	state           signal.StateReader
	signalLogReader *signaldb.SignalLogReader
}

// NewAIBatteryHealthForecaster constructs the adapter. Panics on a
// nil signal.StateReader / *signaldb.SignalLogReader so a wiring
// mistake surfaces at boot — *database.DB may be nil only in tests
// that exercise the snapshot-fallback path.
func NewAIBatteryHealthForecaster(db *database.DB, state signal.StateReader, slr *signaldb.SignalLogReader) *AIBatteryHealthForecaster {
	switch {
	case state == nil:
		panic("aibatthealth: NewAIBatteryHealthForecaster: nil signal.StateReader")
	case slr == nil:
		panic("aibatthealth: NewAIBatteryHealthForecaster: nil *signaldb.SignalLogReader")
	}
	return &AIBatteryHealthForecaster{db: db, state: state, signalLogReader: slr}
}

// ForecastBatteryHealth implements predict.BatteryHealthForecaster.
// Composes the SAME package-level helpers
// *BatteryDegradationHandler uses so the returned envelope is
// numerically identical (modulo rounding) to what
// GET /api/v1/analytics/battery-degradation produces — the AI
// surface is grounded in the SAME deterministic model the chart
// renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing output
// into a typed envelope the LLM can quote.
func (a *AIBatteryHealthForecaster) ForecastBatteryHealth(ctx context.Context, vehicleID int64) (*predict.BatteryHealthForecast, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai battery-health-forecast-narrative: vehicle_id must be > 0")
	}

	// Look up vehicle-specific battery capacity. Mirrors
	// *BatteryDegradationHandler.Predict L60-64.
	capacityWh := 75000.0
	if a.db != nil {
		capacityWh, _ = lookupVehicleCapacityWh(ctx, a.db, vehicleID)
	}

	// Battery health history — reconstruct from signal_log via
	// the same SignalTrace call the canonical handler makes.
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Now()
	entries, err := a.signalLogReader.SignalTrace(ctx, vehicleID,
		[]string{"BatteryLevel", "EnergyRemaining", "EstBatteryRange"}, from, to)
	if err != nil {
		return nil, fmt.Errorf("api ai battery-health-forecast-narrative: signal_log trace: %w", err)
	}
	snapshots := synthesizeBatterySnapshots(entries, capacityWh)
	if snapshots == nil {
		snapshots = []batterySnapshotData{}
	}

	// Current health from the latest snapshot (mirrors
	// *BatteryDegradationHandler.Predict L131-142).
	var currentHealth, currentCapacity, currentRange, currentTemp float64
	var currentCycles int
	if len(snapshots) > 0 {
		latest := snapshots[len(snapshots)-1]
		currentHealth = latest.HealthScore
		currentCapacity = latest.CapacityWh
		currentRange = latest.EstRangeKm
		currentCycles = latest.CycleCount
		currentTemp = latest.AvgCellTempC
	}

	// Fallback path: when no snapshots exist, derive from the
	// canonical signal.StateReader (mirrors
	// *BatteryDegradationHandler.Predict L144-205).
	if currentHealth == 0 {
		now := time.Now()
		val, sigErr := a.state.SignalAt(ctx, vehicleID, "EnergyRemaining", now)
		if sigErr != nil {
			return nil, fmt.Errorf("api ai battery-health-forecast-narrative: state SignalAt EnergyRemaining: %w", sigErr)
		}
		if val != nil {
			if v, ok := toFloatOk(val); ok && v > 0 {
				currentCapacity = v
				currentHealth = (currentCapacity / capacityWh) * 100
				if currentHealth > 100 {
					currentHealth = 100
				}
			}
		}
		val, sigErr = a.state.SignalAt(ctx, vehicleID, "EstBatteryRange", now)
		if sigErr != nil {
			return nil, fmt.Errorf("api ai battery-health-forecast-narrative: state SignalAt EstBatteryRange: %w", sigErr)
		}
		if val != nil {
			if v, ok := toFloatOk(val); ok && v > 0 {
				currentRange = v
			}
		}
		if a.db != nil {
			var delta *float64
			_ = a.db.Pool.QueryRow(ctx,
				`SELECT SUM(GREATEST(end_soc_pct - start_soc_pct, 0))
				 FROM charging_sessions WHERE vehicle_id = $1 AND end_soc_pct > start_soc_pct`,
				vehicleID).Scan(&delta)
			if delta != nil {
				currentCycles = int(*delta / 100)
			}
		}
		if currentHealth > 0 {
			snapshots = []batterySnapshotData{{
				HealthScore:    currentHealth,
				CapacityWh:     currentCapacity,
				DegradationPct: 100 - currentHealth,
				EstRangeKm:     currentRange,
				CycleCount:     currentCycles,
				CreatedAt:      time.Now().UTC(),
			}}
		}
	}

	// Charging habits use the same SQL the canonical Predict handler runs
	// against the SI charging_sessions schema.
	habits := predict.BatteryHealthChargingHabits{}
	if a.db != nil {
		var avgEnergyWh float64
		err = a.db.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE peak_power_w > 50000),
				COUNT(*) FILTER (WHERE peak_power_w <= 50000 OR peak_power_w IS NULL),
				COUNT(*) FILTER (WHERE start_soc_pct < 10),
				COUNT(*) FILTER (WHERE end_soc_pct > 95),
				COUNT(*) FILTER (WHERE end_soc_pct > 90),
				COALESCE(AVG(total_energy_added_wh), 0),
				COUNT(*)
			FROM charging_sessions
			WHERE vehicle_id = $1`, vehicleID).Scan(
			&habits.FastChargeCount, &habits.SlowChargeCount,
			&habits.DeepDischargeCount, &habits.ChargeToFullCount,
			&habits.HighSocCount, &avgEnergyWh,
			&habits.TotalCount)
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("api ai battery-health-forecast-narrative: failed to get charging habits")
			// Non-fatal — return zero counts so the LLM
			// honestly narrates that there are no charging
			// habits to ground the forecast in.
			habits = predict.BatteryHealthChargingHabits{}
		}
	}

	// Linear regression — same predictDegradation helper the
	// canonical handler invokes. The receiver fields aren't used
	// inside predictDegradation, so a zero-valued receiver is
	// safe; we still construct one to make the call site read
	// idiomatically.
	regression := predictDegradation(snapshots)

	// Stress level — exact same buckets the canonical handler
	// uses (Predict L211-222).
	totalCharges := habits.FastChargeCount + habits.SlowChargeCount
	fastChargeRatio := 0.0
	if totalCharges > 0 {
		fastChargeRatio = float64(habits.FastChargeCount) / float64(totalCharges) * 100
	}
	stressLevel := "Low"
	if fastChargeRatio > 50 || habits.DeepDischargeCount > 20 || habits.ChargeToFullCount > totalCharges/2 {
		stressLevel = "High"
	} else if fastChargeRatio > 25 || habits.DeepDischargeCount > 10 || habits.ChargeToFullCount > totalCharges/4 {
		stressLevel = "Medium"
	}
	habits.FastChargeRatioPct = math.Round(fastChargeRatio*10) / 10

	// Risk factors — exact same inputs the canonical handler
	// uses (Predict L223-248).
	ageMonths := 0
	if len(snapshots) > 0 {
		ageMonths = int(time.Since(snapshots[0].CreatedAt).Hours() / (24 * 30.44))
	}
	avgTemp := 25.0
	if len(snapshots) > 0 {
		var totalTemp float64
		for _, s := range snapshots {
			totalTemp += s.AvgCellTempC
		}
		avgTemp = totalTemp / float64(len(snapshots))
	}
	cyclesPerMonth := 0.0
	if ageMonths > 0 {
		cyclesPerMonth = float64(currentCycles) / float64(ageMonths)
	}
	highSocPct := 0.0
	deepDischargePct := 0.0
	if totalCharges > 0 {
		highSocPct = float64(habits.HighSocCount) / float64(totalCharges) * 100
		deepDischargePct = float64(habits.DeepDischargeCount) / float64(totalCharges) * 100
	}
	rfs := computeRiskFactors(fastChargeRatio, highSocPct, avgTemp, cyclesPerMonth, deepDischargePct)
	riskFactors := make([]predict.BatteryHealthRiskFactor, 0, len(rfs))
	for _, rf := range rfs {
		riskFactors = append(riskFactors, predict.BatteryHealthRiskFactor{
			Name:   rf.Name,
			Score:  rf.Score,
			Label:  rf.Label,
			Detail: rf.Detail,
		})
	}

	// Avoid unused variable lint when currentTemp is not used in
	// the envelope yet — kept here for future expansion. Force a
	// no-op read so go vet doesn't flag it.
	_ = currentTemp

	firstSnapshotDate := ""
	if len(snapshots) > 0 {
		firstSnapshotDate = snapshots[0].CreatedAt.Format("2006-01-02")
	}

	// degradation_rate_pct_per_year is the absolute value of the
	// regression slope (the canonical handler exposes SlopePerYear
	// as a signed quantity for the chart but the narrator wants
	// the magnitude).
	slopePerYear := math.Abs(regression.Prediction.SlopePerYear)
	ratePerMonth := math.Round(regression.RatePerMonth*1000) / 1000

	envelope := &predict.BatteryHealthForecast{
		VehicleID:                  vehicleID,
		CurrentHealthPct:           math.Round(currentHealth*10) / 10,
		CurrentCapacityWh:          math.Round(currentCapacity*10) / 10,
		CurrentRangeKm:             math.Round(currentRange*10) / 10,
		BatteryCapacityWh:          capacityWh,
		SnapshotCount:              len(snapshots),
		FirstSnapshotDate:          firstSnapshotDate,
		DegradationRatePctPerYear:  math.Round(slopePerYear*1000) / 1000,
		DegradationRatePctPerMonth: ratePerMonth,
		YearsTo80Pct:               regression.Prediction.YearsTo80Pct,
		Projected80PctDate:         regression.Prediction.PredictedDate,
		HasEnoughData:              regression.Prediction.HasEnoughData,
		StressLevel:                stressLevel,
		ChargingHabits:             habits,
		RiskFactors:                riskFactors,
	}
	return envelope, nil
}

// Compile-time assertion: AIBatteryHealthForecaster satisfies predict.BatteryHealthForecaster.
var _ predict.BatteryHealthForecaster = (*AIBatteryHealthForecaster)(nil)

type batterySnapshotData struct {
	ID             int64     `json:"id"`
	HealthScore    float64   `json:"health_score"`
	CapacityWh     float64   `json:"capacity_wh"`
	DegradationPct float64   `json:"degradation_pct"`
	EstRangeKm     float64   `json:"est_range_km"`
	CycleCount     int       `json:"cycle_count"`
	AvgCellTempC   float64   `json:"avg_cell_temp_c"`
	CreatedAt      time.Time `json:"created_at"`
}

type degradationPrediction struct {
	SlopePerYear     float64 `json:"slope_per_year"`
	YearsTo80Pct     float64 `json:"years_to_80_pct"`
	PredictedDate    string  `json:"predicted_date"`
	HasEnoughData    bool    `json:"has_enough_data"`
	ProjectionPoints []struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	} `json:"projection_points"`
}

type predictiveProjection struct {
	Date           string  `json:"date"`
	HealthPct      float64 `json:"health_pct"`
	ConfidenceLow  float64 `json:"confidence_low"`
	ConfidenceHigh float64 `json:"confidence_high"`
}

type riskFactor struct {
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

type regressionResult struct {
	Prediction   degradationPrediction
	Projections  []predictiveProjection
	RatePerMonth float64
}

func predictDegradation(snapshots []batterySnapshotData) regressionResult {
	res := regressionResult{}
	pred := &res.Prediction

	if len(snapshots) < 3 {
		res.Projections = []predictiveProjection{}
		return res
	}

	pred.HasEnoughData = true
	firstTime := snapshots[0].CreatedAt
	n := float64(len(snapshots))
	var sumX, sumY, sumXY, sumX2 float64

	for _, s := range snapshots {
		x := s.CreatedAt.Sub(firstTime).Hours() / (24 * 365.25)
		y := s.HealthScore
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	xBar := sumX / n
	yBar := sumY / n
	ssx := sumX2 - n*xBar*xBar
	if math.Abs(ssx) < 1e-10 {
		res.Projections = []predictiveProjection{}
		return res
	}

	slope := (sumXY - n*xBar*yBar) / ssx
	intercept := yBar - slope*xBar
	pred.SlopePerYear = math.Round(slope*100) / 100
	res.RatePerMonth = math.Abs(slope) / 12

	var sse float64
	for _, s := range snapshots {
		x := s.CreatedAt.Sub(firstTime).Hours() / (24 * 365.25)
		residual := s.HealthScore - (intercept + slope*x)
		sse += residual * residual
	}
	se := 0.0
	if n > 2 {
		se = math.Sqrt(sse / (n - 2))
	}

	tValue := 2.0
	if n > 30 {
		tValue = 1.96
	}

	if slope < 0 {
		yearsTo80 := (80 - intercept) / slope
		currentYears := time.Since(firstTime).Hours() / (24 * 365.25)
		remainingYears := yearsTo80 - currentYears
		if remainingYears > 0 {
			pred.YearsTo80Pct = math.Round(remainingYears*10) / 10
			predictedTime := time.Now().AddDate(0, int(remainingYears*12), 0)
			pred.PredictedDate = predictedTime.Format("2006-01")
		}
	}

	currentYears := time.Since(firstTime).Hours() / (24 * 365.25)
	type projPoint struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}
	var oldProjections []projPoint
	var enhancedProjections []predictiveProjection

	for i := 0; i <= 36; i++ {
		futureYears := currentYears + float64(i)/12.0
		health := intercept + slope*futureYears
		if health < 0 {
			health = 0
		}
		if health > 100 {
			health = 100
		}
		month := time.Now().AddDate(0, i, 0).Format("2006-01")
		oldProjections = append(oldProjections, projPoint{
			Month:  month,
			Health: math.Round(health*10) / 10,
		})

		xDev := futureYears - xBar
		piWidth := 0.0
		if ssx > 1e-10 && n > 2 {
			piWidth = tValue * se * math.Sqrt(1+1/n+(xDev*xDev)/ssx)
		}
		low := math.Max(0, health-piWidth)
		high := math.Min(100, health+piWidth)
		enhancedProjections = append(enhancedProjections, predictiveProjection{
			Date:           month,
			HealthPct:      math.Round(health*10) / 10,
			ConfidenceLow:  math.Round(low*10) / 10,
			ConfidenceHigh: math.Round(high*10) / 10,
		})
	}

	pred.ProjectionPoints = make([]struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}, len(oldProjections))
	for i, p := range oldProjections {
		pred.ProjectionPoints[i].Month = p.Month
		pred.ProjectionPoints[i].Health = p.Health
	}

	res.Projections = enhancedProjections
	return res
}

func computeRiskFactors(fastChargePct, highSocPct, avgCellTemp, cyclesPerMonth, deepDischargePct float64) []riskFactor {
	factors := make([]riskFactor, 0, 5)

	fastScore := int(math.Min(100, fastChargePct*1.4))
	factors = append(factors, riskFactor{
		Name:   "fast_charge_ratio",
		Score:  fastScore,
		Label:  riskLabel(fastScore),
		Detail: fmt.Sprintf("%.0f%% of sessions are DC fast charge", fastChargePct),
	})

	socScore := int(math.Min(100, highSocPct*1.3))
	factors = append(factors, riskFactor{
		Name:   "high_soc_charging",
		Score:  socScore,
		Label:  riskLabel(socScore),
		Detail: fmt.Sprintf("%.0f%% of sessions charge above 90%%", highSocPct),
	})

	tempScore := 10
	switch {
	case avgCellTemp > 45:
		tempScore = 90
	case avgCellTemp > 40:
		tempScore = 70
	case avgCellTemp > 35:
		tempScore = 50
	case avgCellTemp > 30:
		tempScore = 25
	}
	factors = append(factors, riskFactor{
		Name:   "temperature_exposure",
		Score:  tempScore,
		Label:  riskLabel(tempScore),
		Detail: fmt.Sprintf("Average cell temperature: %.1f\u00b0C", avgCellTemp),
	})

	cycleScore := 15
	switch {
	case cyclesPerMonth > 40:
		cycleScore = 80
	case cyclesPerMonth > 30:
		cycleScore = 55
	case cyclesPerMonth > 20:
		cycleScore = 35
	}
	factors = append(factors, riskFactor{
		Name:   "cycle_count_rate",
		Score:  cycleScore,
		Label:  riskLabel(cycleScore),
		Detail: fmt.Sprintf("%.0f cycles/month vs ~25 typical", cyclesPerMonth),
	})

	deepScore := int(math.Min(100, deepDischargePct*4))
	factors = append(factors, riskFactor{
		Name:   "deep_discharge_frequency",
		Score:  deepScore,
		Label:  riskLabel(deepScore),
		Detail: fmt.Sprintf("%.0f%% of sessions start below 10%% SOC", deepDischargePct),
	})

	return factors
}

func riskLabel(score int) string {
	switch {
	case score <= 25:
		return "Low"
	case score <= 50:
		return "Moderate"
	case score <= 75:
		return "Elevated"
	default:
		return "High"
	}
}

func synthesizeBatterySnapshots(entries []signaldb.SignalTraceEntry, nominalCapacity float64) []batterySnapshotData {
	if len(entries) == 0 {
		return nil
	}

	type group struct {
		ts              time.Time
		batteryLevel    *float64
		energyRemain    *float64
		estBatteryRange *float64
	}
	groupMap := make(map[int64]*group)
	var orderedKeys []int64

	for _, e := range entries {
		key := e.Timestamp.Unix()
		g, ok := groupMap[key]
		if !ok {
			g = &group{ts: e.Timestamp}
			groupMap[key] = g
			orderedKeys = append(orderedKeys, key)
		}
		if e.ValueNum == nil {
			continue
		}
		switch e.Signal {
		case "BatteryLevel":
			v := *e.ValueNum
			g.batteryLevel = &v
		case "EnergyRemaining":
			v := *e.ValueNum
			g.energyRemain = &v
		case "EstBatteryRange":
			v := *e.ValueNum
			g.estBatteryRange = &v
		}
	}

	sort.Slice(orderedKeys, func(i, j int) bool { return orderedKeys[i] < orderedKeys[j] })

	var result []batterySnapshotData
	var idCounter int64
	for _, key := range orderedKeys {
		g := groupMap[key]
		idCounter++

		capacityWh := nominalCapacity
		healthScore := 100.0
		if g.energyRemain != nil && *g.energyRemain > 0 {
			capacityWh = *g.energyRemain
			healthScore = (capacityWh / nominalCapacity) * 100
			if healthScore > 100 {
				healthScore = 100
			}
		}

		estRangeKm := 0.0
		if g.estBatteryRange != nil {
			estRangeKm = *g.estBatteryRange
		}

		result = append(result, batterySnapshotData{
			ID:             idCounter,
			HealthScore:    healthScore,
			CapacityWh:     capacityWh,
			DegradationPct: 100 - healthScore,
			EstRangeKm:     estRangeKm,
			CreatedAt:      g.ts,
		})
	}
	return result
}

func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
}

func lookupVehicleCapacityWh(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75000.0, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return estimateBatteryCapacityWh(vin, m)
}

func estimateBatteryCapacityWh(vin string, model string) (float64, string) {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A':
			return 100000.0, "vin_estimate"
		case 'P':
			return 100000.0, "vin_estimate"
		}
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
}
