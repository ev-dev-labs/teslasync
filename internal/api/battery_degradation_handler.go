package api

import (
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
		FastChargeCount   int     `json:"fast_charge_count"`
		SlowChargeCount   int     `json:"slow_charge_count"`
		DeepDischargeCount int    `json:"deep_discharge_count"`
		ChargeToFullCount int     `json:"charge_to_full_count"`
		AvgEnergyPerSession float64 `json:"avg_energy_per_session"`
	}

	var habits chargingHabits
	err = h.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE charger_power > 50),
			COUNT(*) FILTER (WHERE charger_power <= 50 OR charger_power IS NULL),
			COUNT(*) FILTER (WHERE start_battery_level < 10),
			COUNT(*) FILTER (WHERE end_battery_level > 95),
			COALESCE(AVG(charge_energy_added), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1`, vehicleID).Scan(
		&habits.FastChargeCount, &habits.SlowChargeCount,
		&habits.DeepDischargeCount, &habits.ChargeToFullCount,
		&habits.AvgEnergyPerSession)
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
			`SELECT SUM(GREATEST(end_battery_level - start_battery_level, 0)) 
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_level > start_battery_level`,
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
	prediction := h.predictDegradation(snapshots)

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

	writeJSON(w, http.StatusOK, map[string]interface{}{
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
		"prediction":          prediction,
		"stress_level":        stressLevel,
		"fast_charge_ratio":   math.Round(fastChargeRatio*10) / 10,
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

func (h *BatteryDegradationHandler) predictDegradation(snapshots []batterySnapshotData) degradationPrediction {
	pred := degradationPrediction{}

	if len(snapshots) < 3 {
		return pred
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
	denominator := sumX2 - n*xBar*xBar

	if math.Abs(denominator) < 1e-10 {
		return pred
	}

	slope := (sumXY - n*xBar*yBar) / denominator
	intercept := yBar - slope*xBar

	pred.SlopePerYear = math.Round(slope*100) / 100

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

	// Generate projection points (24 months forward from now)
	currentYears := time.Since(firstTime).Hours() / (24 * 365.25)
	type projPoint struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}
	var projections []projPoint
	for i := 0; i <= 24; i++ {
		futureYears := currentYears + float64(i)/12.0
		health := intercept + slope*futureYears
		if health < 0 {
			health = 0
		}
		if health > 100 {
			health = 100
		}
		month := time.Now().AddDate(0, i, 0).Format("2006-01")
		projections = append(projections, projPoint{
			Month:  month,
			Health: math.Round(health*10) / 10,
		})
	}

	// We need to copy projections into pred in a compatible way
	pred.ProjectionPoints = make([]struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}, len(projections))
	for i, p := range projections {
		pred.ProjectionPoints[i].Month = p.Month
		pred.ProjectionPoints[i].Health = p.Health
	}

	return pred
}
