package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// BatteryDegradationHandler handles battery degradation prediction HTTP requests.
//
// Phase-39 migration: the four per-signal "value as of now" lookups in
// the Predict and Health fallback branches (EnergyRemaining and
// EstBatteryRange in each) now resolve through the canonical
// signal.StateReader (ADR-002 / phase-39) instead of the legacy
// signaldb.SignalLogReader's per-signal helper. The historical
// signal_log trace aggregation in synthesizeBatterySnapshots
// (signaldb.SignalLogReader.SignalTrace) is a SignalLogReader-only
// capability with no StateReader equivalent and is intentionally
// retained side-by-side; only the per-signal at-or-before lookup path
// is migrated here.
//
// As part of this migration, transport errors from state.SignalAt now
// propagate to the caller as a 500 instead of being silently swallowed
// into a partial / zero-valued payload. The legacy silent-swallow
// behavior was indistinguishable on the frontend from "vehicle truly
// idle / brand-new vehicle with no signal_log history" and rendered
// the Battery Degradation panel as "battery looks dead" even when the
// underlying read had genuinely failed.
type BatteryDegradationHandler struct {
	db              *database.DB
	state           signal.StateReader
	signalLogReader *signaldb.SignalLogReader
}

func NewBatteryDegradationHandler(db *database.DB, state signal.StateReader, slr *signaldb.SignalLogReader) *BatteryDegradationHandler {
	return &BatteryDegradationHandler{db: db, state: state, signalLogReader: slr}
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

	// Look up vehicle-specific battery capacity (nil-safe; falls back to
	// the same default that lookupVehicleCapacityWh uses on lookup error).
	capacityWh := 75000.0
	capacitySource := "default"
	if h.db != nil {
		capacityWh, capacitySource = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	}

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
		snapshots = synthesizeBatterySnapshots(entries, capacityWh)
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
	if h.db != nil {
		// Phase-42 SI charging_sessions (migration 000184): peak_power_w
		// (Watts; >50000W == DC fast charging), total_energy_added_wh
		// (Watt-hours), start_soc_pct/end_soc_pct (DOUBLE PRECISION).
		// Convert energy back to kWh at the response boundary so the
		// JSON key avg_energy_per_session keeps its kilowatt-hour
		// semantics for the frontend.
		var avgEnergyWh float64
		err = h.db.Pool.QueryRow(ctx, `
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
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get charging habits")
			// Non-fatal
		}
		habits.AvgEnergyPerSession = avgEnergyWh / 1000.0
	}
	habits.AvgEnergyPerSession = math.Round(habits.AvgEnergyPerSession*10) / 10

	// Current health
	var currentHealth, currentCapacity, currentDegradation, currentRange, currentTemp float64
	var currentCycles int
	if len(snapshots) > 0 {
		latest := snapshots[len(snapshots)-1]
		currentHealth = latest.HealthScore
		currentCapacity = latest.CapacityWh
		currentDegradation = latest.DegradationPct
		currentRange = latest.EstRangeKm
		currentCycles = latest.CycleCount
		currentTemp = latest.AvgCellTempC
	}

	// Fallback: derive from signal_log when no snapshots exist
	if currentHealth == 0 {
		var energy, rng *float64
		if h.state != nil {
			now := time.Now()
			val, sigErr := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").Msg("battery degradation: failed to read signal state")
				writeError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					energy = &v
				}
			}
			val, sigErr = h.state.SignalAt(ctx, vehicleID, "EstBatteryRange", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EstBatteryRange").Msg("battery degradation: failed to read signal state")
				writeError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					rng = &v
				}
			}
		}
		if energy != nil && *energy > 0 {
			currentCapacity = *energy
			currentHealth = (currentCapacity / capacityWh) * 100
			if currentHealth > 100 {
				currentHealth = 100
			}
			currentDegradation = 100 - currentHealth
		}
		if rng != nil {
			currentRange = *rng
		}
		// Cycle count from charge sessions (Phase-42 SI: start_soc_pct/end_soc_pct).
		if h.db != nil {
			var delta *float64
			_ = h.db.Pool.QueryRow(ctx,
				`SELECT SUM(GREATEST(end_soc_pct - start_soc_pct, 0))
				 FROM charging_sessions WHERE vehicle_id = $1 AND end_soc_pct > start_soc_pct`,
				vehicleID).Scan(&delta)
			if delta != nil {
				currentCycles = int(*delta / 100)
			}
		}

		// Synthesize a snapshot so the page has something to show
		if currentHealth > 0 {
			snapshots = []batterySnapshotData{{
				HealthScore:    currentHealth,
				CapacityWh:     currentCapacity,
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
		"battery_capacity_wh": capacityWh,
		"capacity_source":     capacitySource,
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

	// Look up vehicle-specific battery capacity (nil-safe; falls back to
	// the same default that lookupVehicleCapacityWh uses on lookup error).
	capacityWh := 75000.0
	capacitySource := "default"
	if h.db != nil {
		capacityWh, capacitySource = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	}

	// Battery history — reconstruct from signal_log
	type histEntry struct {
		Date       string  `json:"date"`
		Odometer   float64 `json:"odometer"`
		SohPct     float64 `json:"soh_pct"`
		CapacityWh float64 `json:"capacity_wh"`
		RangeKm    float64 `json:"range_km"`
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
		snaps := synthesizeBatterySnapshots(entries, capacityWh)
		for _, s := range snaps {
			if firstDate.IsZero() {
				firstDate = s.CreatedAt
			}
			soh := s.HealthScore
			cap := s.CapacityWh
			rng := s.EstRangeKm
			history = append(history, histEntry{
				Date:       s.CreatedAt.Format("2006-01-02"),
				SohPct:     math.Round(soh*10) / 10,
				CapacityWh: math.Round(cap*10) / 10,
				RangeKm:    math.Round(rng*10) / 10,
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
		if h.state != nil {
			now := time.Now()
			val, sigErr := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").Msg("battery-health: failed to read signal state")
				writeError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					energy = &v
				}
			}
			val, sigErr = h.state.SignalAt(ctx, vehicleID, "EstBatteryRange", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EstBatteryRange").Msg("battery-health: failed to read signal state")
				writeError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					rng = &v
				}
			}
		}
		if energy != nil && *energy > 0 {
			latestCapacity = *energy
			latestSOH = (latestCapacity / capacityWh) * 100
			if latestSOH > 100 {
				latestSOH = 100
			}
		}
		if rng != nil {
			latestRange = *rng
		}
		if h.db != nil {
			var delta *float64
			_ = h.db.Pool.QueryRow(ctx,
				`SELECT SUM(GREATEST(end_soc_pct - start_soc_pct, 0))
				 FROM charging_sessions WHERE vehicle_id = $1 AND end_soc_pct > start_soc_pct`,
				vehicleID).Scan(&delta)
			if delta != nil {
				latestCycles = int(*delta / 100)
			}
		}
		if latestSOH > 0 {
			history = []histEntry{{
				Date:       time.Now().Format("2006-01-02"),
				SohPct:     math.Round(latestSOH*10) / 10,
				CapacityWh: math.Round(latestCapacity*10) / 10,
				RangeKm:    math.Round(latestRange*10) / 10,
			}}
			firstDate = time.Now().AddDate(0, -1, 0)
		}
	}

	// Charging habit stats. Phase-42 SI charging_sessions schema (000184):
	// peak_power_w (Watts; 50000W == 50kW DC fast threshold), start_soc_pct
	// and end_soc_pct (DOUBLE PRECISION).
	var fastCount, slowCount, deepDischarge, fullCharge int
	if h.db != nil {
		_ = h.db.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE peak_power_w > 50000),
				COUNT(*) FILTER (WHERE peak_power_w <= 50000 OR peak_power_w IS NULL),
				COUNT(*) FILTER (WHERE start_soc_pct < 10),
				COUNT(*) FILTER (WHERE end_soc_pct > 95)
			FROM charging_sessions
			WHERE vehicle_id = $1`, vehicleID).Scan(&fastCount, &slowCount, &deepDischarge, &fullCharge)
	}

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

	// Avg depth of discharge — Phase-42 SI drives (000185): start_soc_pct/end_soc_pct.
	var avgDoD *float64
	if h.db != nil {
		_ = h.db.Pool.QueryRow(ctx,
			`SELECT AVG(GREATEST(start_soc_pct - end_soc_pct, 0))
			 FROM drives WHERE vehicle_id = $1 AND start_soc_pct > end_soc_pct`,
			vehicleID).Scan(&avgDoD)
	}
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
	if h.signalLogReader != nil && h.db != nil {
		var avgTemp *float64
		var sampleCount int
		_ = h.db.Pool.QueryRow(ctx, `
			SELECT AVG(COALESCE(float_value, int_value::float8)), COUNT(*)
			FROM signal_log
			WHERE vehicle_id = $1
			  AND field IN ('ModuleTempMax', 'ModuleTempAvg')
			  AND ts > NOW() - INTERVAL '90 days'
			  AND (float_value IS NOT NULL OR int_value IS NOT NULL)`,
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
		"original_capacity":      capacityWh,
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
		"battery_capacity_wh": capacityWh,
		"capacity_source":     capacitySource,
	})
}
