package api

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// BatteryDegradationHandler handles battery degradation prediction HTTP requests.
type BatteryDegradationHandler struct {
	db *database.DB
}

func NewBatteryDegradationHandler(db *database.DB) *BatteryDegradationHandler {
	return &BatteryDegradationHandler{db: db}
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

	// Battery health history
	snapRows, err := h.db.Pool.Query(ctx, `
		SELECT id, health_score, capacity_kwh, degradation_pct,
			est_range_km, cycle_count, avg_cell_temp_c, created_at
		FROM battery_snapshots
		WHERE vehicle_id = $1
		ORDER BY created_at`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get battery snapshots")
		writeError(w, http.StatusInternalServerError, "failed to get battery data")
		return
	}
	defer snapRows.Close()

	var snapshots []batterySnapshotData
	for snapRows.Next() {
		var s batterySnapshotData
		if err := snapRows.Scan(&s.ID, &s.HealthScore, &s.CapacityKWh, &s.DegradationPct,
			&s.EstRangeKm, &s.CycleCount, &s.AvgCellTempC, &s.CreatedAt); err != nil {
			log.Error().Err(err).Msg("failed to scan battery snapshot row")
			continue
		}
		snapshots = append(snapshots, s)
	}
	if snapshots == nil {
		snapshots = []batterySnapshotData{}
	}

	// Monthly averages for trend
	type monthlyTrend struct {
		Month          string  `json:"month"`
		AvgHealth      float64 `json:"avg_health"`
		AvgCapacity    float64 `json:"avg_capacity"`
		AvgDegradation float64 `json:"avg_degradation"`
		AvgRange       float64 `json:"avg_range"`
		MaxCycles      int     `json:"max_cycles"`
		AvgCellTemp    float64 `json:"avg_cell_temp"`
	}

	monthRows, err := h.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', created_at) as month,
			AVG(health_score) as avg_health,
			AVG(capacity_kwh) as avg_capacity,
			AVG(degradation_pct) as avg_degradation,
			AVG(est_range_km) as avg_range,
			MAX(cycle_count) as max_cycles,
			AVG(avg_cell_temp_c) as avg_cell_temp
		FROM battery_snapshots
		WHERE vehicle_id = $1
		GROUP BY month ORDER BY month`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get monthly battery trends")
		writeError(w, http.StatusInternalServerError, "failed to get battery data")
		return
	}
	defer monthRows.Close()

	var monthlyData []monthlyTrend
	for monthRows.Next() {
		var m monthlyTrend
		var monthTime time.Time
		if err := monthRows.Scan(&monthTime, &m.AvgHealth, &m.AvgCapacity, &m.AvgDegradation,
			&m.AvgRange, &m.MaxCycles, &m.AvgCellTemp); err != nil {
			log.Error().Err(err).Msg("failed to scan monthly battery row")
			continue
		}
		m.Month = monthTime.Format("2006-01")
		m.AvgHealth = math.Round(m.AvgHealth*10) / 10
		m.AvgCapacity = math.Round(m.AvgCapacity*10) / 10
		m.AvgDegradation = math.Round(m.AvgDegradation*10) / 10
		m.AvgRange = math.Round(m.AvgRange*10) / 10
		m.AvgCellTemp = math.Round(m.AvgCellTemp*10) / 10
		monthlyData = append(monthlyData, m)
	}
	if monthlyData == nil {
		monthlyData = []monthlyTrend{}
	}

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

	// Fallback: derive from charging_telemetry when no snapshots exist
	if currentHealth == 0 {
		const nominalCapacity = 75.0
		var energy, rng *float64
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT energy_remaining, est_battery_range FROM charging_telemetry 
			 WHERE vehicle_id = $1 AND energy_remaining IS NOT NULL 
			 ORDER BY created_at DESC LIMIT 1`, vehicleID).Scan(&energy, &rng)
		if energy != nil && *energy > 0 {
			currentCapacity = *energy
			currentHealth = (currentCapacity / nominalCapacity) * 100
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
	const nominalCapacity = 75.0

	// Battery snapshots for history
	snapRows, err := h.db.Pool.Query(ctx, `
		SELECT health_score, capacity_kwh, degradation_pct,
			est_range_km, cycle_count, created_at
		FROM battery_snapshots
		WHERE vehicle_id = $1
		ORDER BY created_at`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("battery-health: failed to query snapshots")
		writeError(w, http.StatusInternalServerError, "failed to get battery data")
		return
	}
	defer snapRows.Close()

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

	for snapRows.Next() {
		var healthScore, capacityKWh, degradationPct, rangeKm float64
		var cycleCount int
		var createdAt time.Time
		if err := snapRows.Scan(&healthScore, &capacityKWh, &degradationPct, &rangeKm, &cycleCount, &createdAt); err != nil {
			continue
		}
		if firstDate.IsZero() {
			firstDate = createdAt
		}
		history = append(history, histEntry{
			Date:        createdAt.Format("2006-01-02"),
			SohPct:      math.Round(healthScore*10) / 10,
			CapacityKWh: math.Round(capacityKWh*10) / 10,
			RangeKm:     math.Round(rangeKm*10) / 10,
		})
		latestSOH = healthScore
		latestCapacity = capacityKWh
		latestRange = rangeKm
		latestCycles = cycleCount
	}

	// Fallback from charging_telemetry
	if latestSOH == 0 {
		var energy, rng *float64
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT energy_remaining, est_battery_range FROM charging_telemetry
			 WHERE vehicle_id = $1 AND energy_remaining IS NOT NULL
			 ORDER BY created_at DESC LIMIT 1`, vehicleID).Scan(&energy, &rng)
		if energy != nil && *energy > 0 {
			latestCapacity = *energy
			latestSOH = (latestCapacity / nominalCapacity) * 100
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"current_soh":            math.Round(latestSOH*10) / 10,
		"estimated_capacity":     math.Round(latestCapacity*10) / 10,
		"original_capacity":      nominalCapacity,
		"degradation_rate_yr":    math.Round(degradationRate*100) / 100,
		"battery_age_months":     ageMonths,
		"total_cycles":           latestCycles,
		"avg_depth_of_discharge": math.Round(dod*10) / 10,
		"fast_charge_pct":        math.Round(fastChargePct*10) / 10,
		"full_charge_pct":        math.Round(fullChargePct*10) / 10,
		"charge_habits_score":    math.Round(chargeHabitsScore),
		"temp_exposure_score":    80, // placeholder until temp tracking is granular
		"history":                history,
	})
}
