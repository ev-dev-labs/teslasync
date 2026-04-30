package api

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// BatteryDegradationHandler handles battery degradation prediction HTTP requests.
type BatteryDegradationHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewBatteryDegradationHandler(db *database.DB, slr *database.SignalLogReader) *BatteryDegradationHandler {
	return &BatteryDegradationHandler{db: db, signalLogReader: slr}
}

type batterySnapshotData struct {
	ID             int64     `json:"id"`
	HealthScore    float64   `json:"health_score"`
	CapacityKWh    float64   `json:"capacity_kwh"`
	DegradationPct float64   `json:"degradation_pct"`
	EstRangeKm     float64   `json:"est_range_km"`
	CycleCount     int       `json:"cycle_count"`
	AvgCellTempC   float64   `json:"avg_cell_temp_c"`
	CreatedAt      time.Time `json:"created_at"`
}

func (h *BatteryDegradationHandler) Predict(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Look up vehicle-specific battery capacity
	capacityKWh, capacitySource := lookupVehicleCapacity(ctx, h.db, vehicleID)

	// Battery health history — reconstruct from signal_log
	var snapshots []batterySnapshotData
	if h.signalLogReader != nil {
		// Query BatteryLevel + EnergyRemaining + EstBatteryRange over all time
		from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		to := time.Now()
		entries, err := h.signalLogReader.SignalTrace(ctx, vehicleID,
			[]string{"BatteryLevel", "EnergyRemaining", "EstBatteryRange"}, from, to)
		if err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get battery signal trace")
			writeError(w, http.StatusInternalServerError, "failed to get battery data")
			return
		}
		snapshots = synthesizeBatterySnapshots(entries, capacityKWh)
	}
	if snapshots == nil {
		snapshots = []batterySnapshotData{}
	}

	// Monthly averages — aggregated from synthesized snapshots
	monthlyData := aggregateMonthlyTrends(snapshots)

	// Charging habits that affect battery
	type chargingHabits struct {
		FastChargeCount    int     `json:"fast_charge_count"`
		SlowChargeCount    int     `json:"slow_charge_count"`
		DeepDischargeCount int     `json:"deep_discharge_count"`
		ChargeToFullCount  int     `json:"charge_to_full_count"`
		HighSocCount       int     `json:"high_soc_count"`
		AvgEnergyPerSession float64 `json:"avg_energy_per_session"`
		TotalCount         int     `json:"total_count"`
	}

	var habits chargingHabits
	err = h.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE charger_power_kw_max > 50),
			COUNT(*) FILTER (WHERE charger_power_kw_max <= 50 OR charger_power_kw_max IS NULL),
			COUNT(*) FILTER (WHERE start_battery_pct < 10),
			COUNT(*) FILTER (WHERE end_battery_pct > 95),
			COUNT(*) FILTER (WHERE end_battery_pct > 90),
			COALESCE(AVG(energy_added_kwh), 0),
			COUNT(*)
		FROM charging_sessions
		WHERE vehicle_id = $1`, vehicleID).Scan(
		&habits.FastChargeCount, &habits.SlowChargeCount,
		&habits.DeepDischargeCount, &habits.ChargeToFullCount,
		&habits.HighSocCount, &habits.AvgEnergyPerSession,
		&habits.TotalCount)
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get charging habits")
		// Non-fatal
	}
	habits.AvgEnergyPerSession = math.Round(habits.AvgEnergyPerSession*10) / 10

	// Current health
	var currentHealth, currentCapacity, currentDegradation, currentRange, currentTemp float64
	var currentCycles int
	if len(snapshots) > 0 {
		latest := snapshots[len(snapshots)-1]
		currentHealth = latest.HealthScore
		currentCapacity = latest.CapacityKWh
		currentDegradation = latest.DegradationPct
		currentRange = latest.EstRangeKm
		currentCycles = latest.CycleCount
		currentTemp = latest.AvgCellTempC
	}

	// Fallback: derive from signal_log when no snapshots exist
	if currentHealth == 0 {
		var energy, rng *float64
		if h.signalLogReader != nil {
			now := time.Now()
			if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EnergyRemaining", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					energy = &v
				}
			}
			if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EstBatteryRange", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					rng = &v
				}
			}
		}
		if energy != nil && *energy > 0 {
			currentCapacity = *energy
			currentHealth = (currentCapacity / capacityKWh) * 100
			if currentHealth > 100 { currentHealth = 100 }
			currentDegradation = 100 - currentHealth
		}
		if rng != nil { currentRange = *rng }
		// Cycle count from charge sessions
		var delta *float64
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT SUM(GREATEST(end_battery_pct - start_battery_pct, 0)) 
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_pct > start_battery_pct`,
			vehicleID).Scan(&delta)
		if delta != nil { currentCycles = int(*delta / 100) }

		// Synthesize a snapshot so the page has something to show
		if currentHealth > 0 {
			snapshots = []batterySnapshotData{{
				HealthScore:  currentHealth,
				CapacityKWh:  currentCapacity,
				DegradationPct: currentDegradation,
				EstRangeKm:   currentRange,
				CycleCount:   currentCycles,
				CreatedAt:    time.Now().UTC(),
			}}
		}
	}

	// Linear regression to predict when health reaches 80%
	result := h.predictDegradation(snapshots)

	// Stress level assessment
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

	// Risk factor scoring
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

	riskFactors := computeRiskFactors(fastChargeRatio, highSocPct, avgTemp, cyclesPerMonth, deepDischargePct)
	recommendations := generateRecommendations(riskFactors)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		// Existing fields (backward compatible)
		"vehicle_id":          vehicleID,
		"current_health":      currentHealth,
		"current_capacity":    currentCapacity,
		"current_degradation": currentDegradation,
		"current_range":       currentRange,
		"current_cycles":      currentCycles,
		"current_temp":        currentTemp,
		"monthly_trend":       monthlyData,
		"snapshots":           snapshots,
		"charging_habits":     habits,
		"prediction":          result.Prediction,
		"stress_level":        stressLevel,
		"fast_charge_ratio":   math.Round(fastChargeRatio*10) / 10,
		// New predictive fields
		"current_health_pct":            currentHealth,
		"degradation_rate_pct_per_month": math.Round(result.RatePerMonth*1000) / 1000,
		"projected_80pct_date":          result.Prediction.PredictedDate,
		"projections":                   result.Projections,
		"risk_factors":                  riskFactors,
		"recommendations":               recommendations,
		// Capacity estimate metadata
		"battery_capacity_kwh": capacityKWh,
		"capacity_source":      capacitySource,
	})
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

func (h *BatteryDegradationHandler) predictDegradation(snapshots []batterySnapshotData) regressionResult {
	res := regressionResult{}
	pred := &res.Prediction

	if len(snapshots) < 3 {
		res.Projections = []predictiveProjection{}
		return res
	}

	pred.HasEnoughData = true

	// Simple linear regression: health_score vs time (in years from first snapshot)
	firstTime := snapshots[0].CreatedAt
	n := float64(len(snapshots))
	var sumX, sumY, sumXY, sumX2 float64

	for _, s := range snapshots {
		x := s.CreatedAt.Sub(firstTime).Hours() / (24 * 365.25) // years
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

	// Residual standard error for confidence intervals
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

	// t-value for 95% prediction interval (approximate)
	tValue := 2.0
	if n > 30 {
		tValue = 1.96
	}

	// Predict when health reaches 80%
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

	// Generate projection points (36 months / 3 years forward)
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

		// Prediction interval width at this point
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

// computeRiskFactors scores 5 battery risk categories (0-100, higher = more risk).
func computeRiskFactors(fastChargePct, highSocPct, avgCellTemp, cyclesPerMonth, deepDischargePct float64) []riskFactor {
	factors := make([]riskFactor, 0, 5)

	// 1. Fast charge ratio
	fastScore := int(math.Min(100, fastChargePct*1.4))
	factors = append(factors, riskFactor{
		Name:   "fast_charge_ratio",
		Score:  fastScore,
		Label:  riskLabel(fastScore),
		Detail: fmt.Sprintf("%.0f%% of sessions are DC fast charge", fastChargePct),
	})

	// 2. High SOC charging (sessions ending above 90%)
	socScore := int(math.Min(100, highSocPct*1.3))
	factors = append(factors, riskFactor{
		Name:   "high_soc_charging",
		Score:  socScore,
		Label:  riskLabel(socScore),
		Detail: fmt.Sprintf("%.0f%% of sessions charge above 90%%", highSocPct),
	})

	// 3. Temperature exposure
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
		Detail: fmt.Sprintf("Average cell temperature: %.1f°C", avgCellTemp),
	})

	// 4. Cycle count rate (vs ~25 cycles/month typical baseline)
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

	// 5. Deep discharge frequency (sessions starting below 10% SOC)
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

// generateRecommendations produces actionable tips based on elevated risk factors.
func generateRecommendations(factors []riskFactor) []string {
	recs := make([]string, 0)
	for _, f := range factors {
		if f.Score <= 40 {
			continue
		}
		switch f.Name {
		case "fast_charge_ratio":
			recs = append(recs, "Reduce Supercharging frequency — prefer Level 2 home or destination charging")
		case "high_soc_charging":
			recs = append(recs, "Reduce daily charge limit to 80% for everyday driving")
		case "temperature_exposure":
			recs = append(recs, "Park in shade or climate-controlled garage to reduce heat exposure")
		case "cycle_count_rate":
			recs = append(recs, "Combine short trips when possible to reduce charge cycle frequency")
		case "deep_discharge_frequency":
			recs = append(recs, "Avoid letting battery drop below 20% regularly — plug in nightly")
		}
	}
	if len(recs) == 0 {
		recs = append(recs, "Your battery habits are excellent — keep it up!")
	}
	return recs
}

// Health handles GET /analytics/battery-health?vehicle_id=X
// Returns data shaped for the BatteryDegradationPage frontend.
func (h *BatteryDegradationHandler) Health(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Look up vehicle-specific battery capacity
	capacityKWh, capacitySource := lookupVehicleCapacity(ctx, h.db, vehicleID)

	// Battery history — reconstruct from signal_log
	type histEntry struct {
		Date        string  `json:"date"`
		Odometer    float64 `json:"odometer"`
		SohPct      float64 `json:"soh_pct"`
		CapacityKWh float64 `json:"capacity_kwh"`
		RangeKm     float64 `json:"range_km"`
	}

	var history []histEntry
	var latestSOH, latestCapacity, latestRange float64
	var latestCycles int
	var firstDate time.Time

	if h.signalLogReader != nil {
		from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		to := time.Now()
		entries, traceErr := h.signalLogReader.SignalTrace(ctx, vehicleID,
			[]string{"BatteryLevel", "EnergyRemaining", "EstBatteryRange"}, from, to)
		if traceErr != nil {
			log.Error().Err(traceErr).Int64("vehicleID", vehicleID).Msg("battery-health: failed to query signal_log")
			writeError(w, http.StatusInternalServerError, "failed to get battery data")
			return
		}
		snaps := synthesizeBatterySnapshots(entries, capacityKWh)
		for _, s := range snaps {
			if firstDate.IsZero() {
				firstDate = s.CreatedAt
			}
			soh := s.HealthScore
			cap := s.CapacityKWh
			rng := s.EstRangeKm
			history = append(history, histEntry{
				Date:        s.CreatedAt.Format("2006-01-02"),
				SohPct:      math.Round(soh*10) / 10,
				CapacityKWh: math.Round(cap*10) / 10,
				RangeKm:     math.Round(rng*10) / 10,
			})
			latestSOH = soh
			latestCapacity = cap
			latestRange = rng
			latestCycles = s.CycleCount
		}
	}

	// Fallback from signal_log
	if latestSOH == 0 {
		var energy, rng *float64
		if h.signalLogReader != nil {
			now := time.Now()
			if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EnergyRemaining", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					energy = &v
				}
			}
			if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EstBatteryRange", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					rng = &v
				}
			}
		}
		if energy != nil && *energy > 0 {
			latestCapacity = *energy
			latestSOH = (latestCapacity / capacityKWh) * 100
			if latestSOH > 100 {
				latestSOH = 100
			}
		}
		if rng != nil {
			latestRange = *rng
		}
		var delta *float64
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT SUM(GREATEST(end_battery_pct - start_battery_pct, 0))
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_pct > start_battery_pct`,
			vehicleID).Scan(&delta)
		if delta != nil {
			latestCycles = int(*delta / 100)
		}
		if latestSOH > 0 {
			history = []histEntry{{
				Date:        time.Now().Format("2006-01-02"),
				SohPct:      math.Round(latestSOH*10) / 10,
				CapacityKWh: math.Round(latestCapacity*10) / 10,
				RangeKm:     math.Round(latestRange*10) / 10,
			}}
			firstDate = time.Now().AddDate(0, -1, 0)
		}
	}

	// Charging habit stats
	var fastCount, slowCount, deepDischarge, fullCharge int
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE charger_power_kw_max > 50),
			COUNT(*) FILTER (WHERE charger_power_kw_max <= 50 OR charger_power_kw_max IS NULL),
			COUNT(*) FILTER (WHERE start_battery_pct < 10),
			COUNT(*) FILTER (WHERE end_battery_pct > 95)
		FROM charging_sessions
		WHERE vehicle_id = $1`, vehicleID).Scan(&fastCount, &slowCount, &deepDischarge, &fullCharge)

	totalCharges := fastCount + slowCount
	fastChargePct := 0.0
	fullChargePct := 0.0
	if totalCharges > 0 {
		fastChargePct = float64(fastCount) / float64(totalCharges) * 100
		fullChargePct = float64(fullCharge) / float64(totalCharges) * 100
	}

	// Calculate scores
	chargeHabitsScore := 100.0
	if fastChargePct > 50 {
		chargeHabitsScore -= 30
	} else if fastChargePct > 25 {
		chargeHabitsScore -= 15
	}
	if fullChargePct > 50 {
		chargeHabitsScore -= 20
	} else if fullChargePct > 25 {
		chargeHabitsScore -= 10
	}
	if deepDischarge > 20 {
		chargeHabitsScore -= 20
	} else if deepDischarge > 10 {
		chargeHabitsScore -= 10
	}
	if chargeHabitsScore < 0 {
		chargeHabitsScore = 0
	}

	// Age
	ageMonths := 0
	if !firstDate.IsZero() {
		ageMonths = int(time.Since(firstDate).Hours() / (24 * 30.44))
	}

	// Degradation rate per year
	degradationRate := 0.0
	if ageMonths > 0 && latestSOH > 0 && latestSOH < 100 {
		degradationRate = (100 - latestSOH) / (float64(ageMonths) / 12)
	}

	// Avg depth of discharge
	var avgDoD *float64
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT AVG(GREATEST(start_battery_pct - end_battery_pct, 0))
		 FROM drives WHERE vehicle_id = $1 AND start_battery_pct > end_battery_pct`,
		vehicleID).Scan(&avgDoD)
	dod := 0.0
	if avgDoD != nil {
		dod = *avgDoD
	}

	if history == nil {
		history = []histEntry{}
	}

	// Compute temp exposure score from actual ModuleTempMax signal data
	var tempExposureScore interface{}
	var tempExposureReason interface{}
	if h.signalLogReader != nil {
		var avgTemp *float64
		var sampleCount int
		_ = h.db.Pool.QueryRow(ctx, `
			SELECT AVG(value_num), COUNT(*)
			FROM signal_log
			WHERE vehicle_id = $1
			  AND signal IN ('ModuleTempMax', 'ModuleTempAvg')
			  AND created_at > NOW() - INTERVAL '90 days'
			  AND value_num IS NOT NULL`,
			vehicleID).Scan(&avgTemp, &sampleCount)
		if avgTemp != nil && sampleCount >= 10 {
			t := *avgTemp
			score := 10
			switch {
			case t > 45:
				score = 90
			case t > 40:
				score = 70
			case t > 35:
				score = 50
			case t > 30:
				score = 25
			}
			tempExposureScore = score
		} else {
			tempExposureReason = "insufficient_data"
		}
	} else {
		tempExposureReason = "insufficient_data"
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"current_soh":            math.Round(latestSOH*10) / 10,
		"estimated_capacity":     math.Round(latestCapacity*10) / 10,
		"original_capacity":      capacityKWh,
		"degradation_rate_yr":    math.Round(degradationRate*100) / 100,
		"battery_age_months":     ageMonths,
		"total_cycles":           latestCycles,
		"avg_depth_of_discharge": math.Round(dod*10) / 10,
		"fast_charge_pct":        math.Round(fastChargePct*10) / 10,
		"full_charge_pct":        math.Round(fullChargePct*10) / 10,
		"charge_habits_score":    math.Round(chargeHabitsScore),
		"temp_exposure_score":    tempExposureScore,
		"temp_exposure_reason":   tempExposureReason,
		"history":                history,
		// Capacity estimate metadata
		"battery_capacity_kwh": capacityKWh,
		"capacity_source":      capacitySource,
	})
}

// synthesizeBatterySnapshots converts signal trace entries into the legacy
// batterySnapshotData shape expected by the prediction and display code.
// Entries are grouped by timestamp; each unique timestamp yields one snapshot.
// nominalCapacity is the vehicle-specific estimated capacity in kWh.
func synthesizeBatterySnapshots(entries []database.SignalTraceEntry, nominalCapacity float64) []batterySnapshotData {
	if len(entries) == 0 {
		return nil
	}

	// Group entries by timestamp (rounded to the nearest second)
	type group struct {
		ts              time.Time
		batteryLevel    *float64
		energyRemain    *float64
		estBatteryRange *float64
	}
	groupMap := make(map[int64]*group) // unix seconds → group
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

		// Derive health_score from EnergyRemaining / nominal
		capacityKWh := nominalCapacity
		healthScore := 100.0
		if g.energyRemain != nil && *g.energyRemain > 0 {
			capacityKWh = *g.energyRemain
			healthScore = (capacityKWh / nominalCapacity) * 100
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
			CapacityKWh:    capacityKWh,
			DegradationPct: 100 - healthScore,
			EstRangeKm:     estRangeKm,
			CreatedAt:      g.ts,
		})
	}
	return result
}

// monthlyTrend holds monthly aggregation of battery health data.
type monthlyTrend struct {
	Month          string  `json:"month"`
	AvgHealth      float64 `json:"avg_health"`
	AvgCapacity    float64 `json:"avg_capacity"`
	AvgDegradation float64 `json:"avg_degradation"`
	AvgRange       float64 `json:"avg_range"`
	MaxCycles      int     `json:"max_cycles"`
	AvgCellTemp    float64 `json:"avg_cell_temp"`
}

// aggregateMonthlyTrends groups synthesized snapshots by month and computes averages.
func aggregateMonthlyTrends(snapshots []batterySnapshotData) []monthlyTrend {
	if len(snapshots) == 0 {
		return []monthlyTrend{}
	}

	type monthAccum struct {
		sumHealth      float64
		sumCapacity    float64
		sumDegradation float64
		sumRange       float64
		sumTemp        float64
		maxCycles      int
		count          int
	}

	months := make(map[string]*monthAccum)
	var monthOrder []string

	for _, s := range snapshots {
		key := s.CreatedAt.Format("2006-01")
		acc, ok := months[key]
		if !ok {
			acc = &monthAccum{}
			months[key] = acc
			monthOrder = append(monthOrder, key)
		}
		acc.sumHealth += s.HealthScore
		acc.sumCapacity += s.CapacityKWh
		acc.sumDegradation += s.DegradationPct
		acc.sumRange += s.EstRangeKm
		acc.sumTemp += s.AvgCellTempC
		if s.CycleCount > acc.maxCycles {
			acc.maxCycles = s.CycleCount
		}
		acc.count++
	}

	sort.Strings(monthOrder)

	result := make([]monthlyTrend, 0, len(monthOrder))
	for _, key := range monthOrder {
		acc := months[key]
		n := float64(acc.count)
		result = append(result, monthlyTrend{
			Month:          key,
			AvgHealth:      math.Round(acc.sumHealth/n*10) / 10,
			AvgCapacity:    math.Round(acc.sumCapacity/n*10) / 10,
			AvgDegradation: math.Round(acc.sumDegradation/n*10) / 10,
			AvgRange:       math.Round(acc.sumRange/n*10) / 10,
			MaxCycles:      acc.maxCycles,
			AvgCellTemp:    math.Round(acc.sumTemp/n*10) / 10,
		})
	}
	return result
}
