package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// BatteryDegradationHandler handles battery degradation prediction HTTP requests.
type BatteryDegradationHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewBatteryDegradationHandler(db *database.DB, slr *database.SignalLogReader) *BatteryDegradationHandler {
	return &BatteryDegradationHandler{db: db, signalLogReader: slr}
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
		FastChargeCount     int     `json:"fast_charge_count"`
		SlowChargeCount     int     `json:"slow_charge_count"`
		DeepDischargeCount  int     `json:"deep_discharge_count"`
		ChargeToFullCount   int     `json:"charge_to_full_count"`
		HighSocCount        int     `json:"high_soc_count"`
		AvgEnergyPerSession float64 `json:"avg_energy_per_session"`
		TotalCount          int     `json:"total_count"`
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
			if currentHealth > 100 {
				currentHealth = 100
			}
			currentDegradation = 100 - currentHealth
		}
		if rng != nil {
			currentRange = *rng
		}
		// Cycle count from charge sessions
		var delta *float64
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT SUM(GREATEST(end_battery_pct - start_battery_pct, 0)) 
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_pct > start_battery_pct`,
			vehicleID).Scan(&delta)
		if delta != nil {
			currentCycles = int(*delta / 100)
		}

		// Synthesize a snapshot so the page has something to show
		if currentHealth > 0 {
			snapshots = []batterySnapshotData{{
				HealthScore:    currentHealth,
				CapacityKWh:    currentCapacity,
				DegradationPct: currentDegradation,
				EstRangeKm:     currentRange,
				CycleCount:     currentCycles,
				CreatedAt:      time.Now().UTC(),
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
		"current_health_pct":             currentHealth,
		"degradation_rate_pct_per_month": math.Round(result.RatePerMonth*1000) / 1000,
		"projected_80pct_date":           result.Prediction.PredictedDate,
		"projections":                    result.Projections,
		"risk_factors":                   riskFactors,
		"recommendations":                recommendations,
		// Capacity estimate metadata
		"battery_capacity_kwh": capacityKWh,
		"capacity_source":      capacitySource,
	})
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
