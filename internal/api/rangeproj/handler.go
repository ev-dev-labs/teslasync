package rangeproj

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const driveStatsMetersPerMile = 1609.344

func estimateBatteryCapacityWh(vin string, model string) (float64, string) {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A', 'P':
			return 100000.0, "vin_estimate"
		}
	}

	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
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

// RangeProjectionHandler serves projected range analytics.
//
// The legacy *signaldb.SignalLogReader has been replaced
// with the canonical signal.StateReader (ADR-002). All 9 per-signal
// reads across Get and GetByVehicle resolve "value as of now" — a forward-
// folded read at time.Now() — so they map 1:1 onto StateReader.SignalAt with
// identical semantics.
//
// As part of this migration, transport errors from state.SignalAt now
// propagate to the caller as a 500 instead of being silently swallowed. The
// legacy silent-swallow returned a payload with zero-valued range and
// degradation, which is indistinguishable on the frontend from "vehicle
// truly idle / brand-new vehicle with no signal_log history" — masking a
// real signal-store / pgx outage behind a "range looks dead" panel.
//
// The "signal value never emitted" case (StateReader returns (nil, nil)) is
// still handled by falling through to the existing zero/default fallbacks,
// matching the legacy "missing data" UX.
type RangeProjectionHandler struct {
	db         *database.DB
	state      signal.StateReader
	redisCache *signal.RedisSignalCache
}

func NewRangeProjectionHandler(db *database.DB, state signal.StateReader) *RangeProjectionHandler {
	return &RangeProjectionHandler{db: db, state: state}
}

// WithRedisCache sets the Redis signal cache for reading live vehicle state.
func (h *RangeProjectionHandler) WithRedisCache(cache *signal.RedisSignalCache) *RangeProjectionHandler {
	h.redisCache = cache
	return h
}

// Get handles GET /analytics/range-projection?vehicle_id=X
func (h *RangeProjectionHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Look up vehicle-specific battery capacity
	var capacityWh float64
	if h.db != nil {
		capacityWh, _ = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	} else {
		capacityWh = 75000.0 // default Model 3/Y capacity
	}

	// Current battery state from canonical StateReader (forward-folded
	// signal_log). Each per-signal read maps 1:1 onto SignalAt with
	// identical semantics; transport errors propagate as 500.
	var batteryLevel, estRange, ratedRange, idealRange *float64
	if h.state != nil {
		now := time.Now()
		val, err := h.state.SignalAt(ctx, vehicleID, "BatteryLevel", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "BatteryLevel").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				batteryLevel = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "EstBatteryRange", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "EstBatteryRange").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				estRange = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "RatedRange", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "RatedRange").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				ratedRange = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "IdealBatteryRange", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "IdealBatteryRange").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				idealRange = &v
			}
		}
	}

	// Current outside temp from Redis signal cache
	var currentOutsideTemp *float64
	if h.redisCache != nil {
		if val, err := h.redisCache.GetSignal(ctx, vehicleID, "OutsideTemp"); err == nil {
			if f, ok := val.(float64); ok {
				currentOutsideTemp = &f
			}
		}
	}

	// Recent driving efficiency uses SI drive columns:
	// energy_used_wh (Watt-hours), distance_m (meters), avg_speed_mps,
	// ambient_temp_c_avg. avgEffWhKm is computed as Wh / km.
	// The legacy "AVG() ORDER BY LIMIT 30" pattern was invalid SQL, so this
	// selects the most-recent 30 drives in a CTE first, then
	// averaging. avgSpeedKmh is averaged in mps and converted to km/h at
	// the response boundary so downstream buildRangeFactors keeps its
	// km/h-input contract.
	var avgEffWhKm *float64
	var avgTempC *float64
	var avgSpeedKmh *float64
	if h.db != nil {
		if err := h.db.Pool.QueryRow(ctx, `
		WITH recent AS (
			SELECT energy_used_wh, distance_m
			FROM drives
			WHERE vehicle_id = $1 AND distance_m > $2
			ORDER BY started_at DESC
			LIMIT 30
		)
		SELECT AVG(
			CASE WHEN distance_m > 0 THEN
				COALESCE(energy_used_wh, 0)
				/ NULLIF(distance_m / 1000.0, 0)
			END
		)
		FROM recent`, vehicleID, driveStatsMetersPerMile).Scan(&avgEffWhKm); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: avg efficiency query failed")
		}

		if err := h.db.Pool.QueryRow(ctx, `
		SELECT AVG(ambient_temp_c_avg)
		FROM drives
		WHERE vehicle_id = $1 AND ambient_temp_c_avg IS NOT NULL
		  AND started_at > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgTempC); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: avg temp query failed")
		}

		var avgSpeedMps *float64
		if err := h.db.Pool.QueryRow(ctx, `
		SELECT AVG(avg_speed_mps)
		FROM drives
		WHERE vehicle_id = $1 AND avg_speed_mps IS NOT NULL AND avg_speed_mps > 0
		  AND started_at > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgSpeedMps); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: avg speed query failed")
		}
		if avgSpeedMps != nil {
			kmh := *avgSpeedMps * 3.6
			avgSpeedKmh = &kmh
		}
	}

	// ── Efficiency matrix ────────────────────────────────
	var matrix []efficiencyBucket
	if h.db != nil {
		matrix = h.buildEfficiencyMatrix(ctx, vehicleID, capacityWh)
	} else {
		matrix = []efficiencyBucket{}
	}

	// ── Battery health / degradation adjustment ──────────
	var healthScore *float64
	if h.state != nil {
		val, err := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", time.Now())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if energy, ok := val.(float64); ok && energy > 0 {
				hs := (energy / capacityWh) * 100
				if hs > 100 {
					hs = 100
				}
				healthScore = &hs
			}
		}
	}

	healthFactor := 1.0
	if healthScore != nil && *healthScore > 0 && *healthScore < 100 {
		healthFactor = *healthScore / 100
	}
	usableCapacity := capacityWh * healthFactor

	// ── Build original response fields ───────────────────
	bl := ptrF64(batteryLevel)
	rated := ptrF64(ratedRange)
	est := ptrF64(estRange)
	ideal := ptrF64(idealRange)

	if rated == 0 && ideal > 0 {
		rated = ideal
	}
	if rated == 0 && est > 0 {
		rated = est
	}

	effFactor := 1.0
	if rated > 0 && est > 0 {
		effFactor = est / rated
	}

	factors := buildRangeFactors(avgTempC, avgSpeedKmh, avgEffWhKm)
	totalImpact := 0.0
	for _, f := range factors {
		totalImpact += f.ImpactPct
	}
	effFactor = math.Max(0.3, math.Min(1.3, effFactor+totalImpact/100))

	projectedRange := rated * effFactor
	adjustedRange := rated // rated adjusted for current SOC
	if bl > 0 && bl < 100 {
		adjustedRange = rated * bl / 100
		projectedRange = projectedRange * bl / 100
	}

	ratedAt100 := rated // original rated is the 100% reference
	projAt100 := ratedAt100 * effFactor

	curve := make([]curvePoint, 0, 21)
	for pct := 0; pct <= 100; pct += 5 {
		curve = append(curve, curvePoint{
			BatteryPct:     pct,
			RatedRange:     math.Round(ratedAt100*float64(pct)/100*10) / 10,
			ProjectedRange: math.Round(projAt100*float64(pct)/100*10) / 10,
		})
	}

	// ── Scenario projections ─────────────────────────────
	scenarios := h.buildScenarios(matrix, bl, usableCapacity, currentOutsideTemp)

	// Tesla estimate (rated range at current battery level)
	teslaEstKm := adjustedRange
	yourEstKm := projectedRange

	// Sample count uses SI columns distance_m / start_soc_pct / end_soc_pct.
	// `> 5 miles` becomes `> 8046.72 m` (5 * driveStatsMetersPerMile).
	var totalDrives int
	var firstDrive *time.Time
	if h.db != nil {
		if err := h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM drives WHERE vehicle_id = $1 AND distance_m > $2 AND start_soc_pct > end_soc_pct`,
			vehicleID, 5*driveStatsMetersPerMile).Scan(&totalDrives); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: drive count query failed")
		}

		// First drive date for accuracy note
		if err := h.db.Pool.QueryRow(ctx, `
		SELECT MIN(started_at) FROM drives WHERE vehicle_id = $1 AND distance_m > 0`,
			vehicleID).Scan(&firstDrive); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: first drive query failed")
		}
	}
	monthsOfData := 0
	if firstDrive != nil {
		monthsOfData = int(time.Since(*firstDrive).Hours() / (24 * 30.44))
	}

	accuracyNote := fmt.Sprintf("Based on %d drives", totalDrives)
	if monthsOfData > 0 {
		accuracyNote = fmt.Sprintf("Based on %d drives over %d months", totalDrives, monthsOfData)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		// Original fields (backward compatible)
		"current_range_km":   math.Round(adjustedRange*10) / 10,
		"projected_range_km": math.Round(projectedRange*10) / 10,
		"battery_level":      math.Round(bl*10) / 10,
		"efficiency_factor":  math.Round(effFactor*1000) / 1000,
		"factors":            factors,
		"projection_curve":   curve,
		// Enhanced fields
		"current_battery_pct": math.Round(bl*10) / 10,
		"usable_capacity_wh":  math.Round(usableCapacity*10) / 10,
		"health_factor":       math.Round(healthFactor*1000) / 1000,
		"scenarios":           scenarios,
		"efficiency_matrix":   matrix,
		"tesla_estimate_km":   math.Round(teslaEstKm*10) / 10,
		"your_estimate_km":    math.Round(yourEstKm*10) / 10,
		"accuracy_note":       accuracyNote,
	})
}

// ── Efficiency matrix ────────────────────────────────────────

func (h *RangeProjectionHandler) buildEfficiencyMatrix(ctx context.Context, vehicleID int64, capacityWh float64) []efficiencyBucket {
	// Speed buckets are translated from mph to mps:
	// 50/90 mph -> 22.352 / 40.2336 mps. The Wh/km formula preserves the
	// legacy "delta_pct * capacity * 10 / distance" shape — even
	// though the column is aliased wh_per_km, it has historically returned
	// per-mile values; the SI rewrite keeps that numeric output by using
	// `distance_m / driveStatsMetersPerMile` (i.e. miles) as denominator,
	// matching the covenant requirement to preserve analytics math.
	rows, err := h.db.Pool.Query(ctx, `
		SELECT
			CASE
				WHEN ambient_temp_c_avg < 0 THEN 'freezing'
				WHEN ambient_temp_c_avg < 10 THEN 'cold'
				WHEN ambient_temp_c_avg < 25 THEN 'mild'
				ELSE 'hot'
			END AS temp_bucket,
			CASE
				WHEN avg_speed_mps < 22.352 THEN 'city'
				WHEN avg_speed_mps < 40.2336 THEN 'suburban'
				ELSE 'highway'
			END AS speed_bucket,
			AVG((start_soc_pct - end_soc_pct) * $2 * 10 / NULLIF(distance_m / $3, 0)) AS wh_per_km,
			COUNT(*) AS sample_count
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $4 AND start_soc_pct > end_soc_pct
		  AND ambient_temp_c_avg IS NOT NULL AND avg_speed_mps IS NOT NULL
		GROUP BY temp_bucket, speed_bucket
		HAVING COUNT(*) >= 3`,
		vehicleID, capacityWh/1000.0, driveStatsMetersPerMile, 5*driveStatsMetersPerMile)
	if err != nil {
		return []efficiencyBucket{}
	}
	defer rows.Close()

	var buckets []efficiencyBucket
	for rows.Next() {
		var b efficiencyBucket
		if err := rows.Scan(&b.TempBucket, &b.SpeedBucket, &b.WhKm, &b.Samples); err != nil {
			continue
		}
		b.WhKm = math.Round(b.WhKm*10) / 10
		buckets = append(buckets, b)
	}
	if buckets == nil {
		buckets = []efficiencyBucket{}
	}
	return buckets
}

// ── Scenario projections ─────────────────────────────────────

func (h *RangeProjectionHandler) buildScenarios(matrix []efficiencyBucket, batteryPct, usableCapWh float64, outsideTemp *float64) []rangeScenario {
	lookup := make(map[string]efficiencyBucket)
	for _, b := range matrix {
		lookup[b.TempBucket+"|"+b.SpeedBucket] = b
	}

	calcRange := func(effWhKm float64) (km, mi float64) {
		if effWhKm <= 0 {
			return 0, 0
		}
		km = usableCapWh * (batteryPct / 100) / effWhKm
		mi = km * 0.621371
		return math.Round(km*10) / 10, math.Round(mi*10) / 10
	}

	type scenarioDef struct {
		name   string
		temp   string
		speed  string
		tempC  int
		speedK int
		extras []string
	}

	defs := []scenarioDef{
		{"City (Mild)", "mild", "city", 20, 35, nil},
		{"Suburban (Mild)", "mild", "suburban", 20, 70, nil},
		{"Highway (Mild)", "mild", "highway", 20, 110, nil},
		{"City (Cold)", "cold", "city", 5, 35, nil},
		{"Highway (Cold) + HVAC", "freezing", "highway", -5, 110, []string{"hvac"}},
		{"Highway + Sentry", "mild", "highway", 20, 110, []string{"sentry"}},
	}

	scenarios := make([]rangeScenario, 0, len(defs)+1)
	for _, d := range defs {
		eff := getEfficiency(lookup, d.temp, d.speed)
		if eff <= 0 {
			eff = defaultEfficiency(d.tempC, d.speedK)
		}
		// Add HVAC overhead
		for _, x := range d.extras {
			switch x {
			case "hvac":
				hvacKW := math.Max(0, math.Abs(float64(22-d.tempC))*0.1)
				if d.speedK > 0 {
					eff += hvacKW * 1000 / float64(d.speedK)
				}
			case "sentry":
				if d.speedK > 0 {
					eff += 300.0 / float64(d.speedK)
				}
			}
		}
		km, mi := calcRange(eff)
		samples := 0
		if b, ok := lookup[d.temp+"|"+d.speed]; ok {
			samples = b.Samples
		}
		extras := d.extras
		if extras == nil {
			extras = []string{}
		}
		scenarios = append(scenarios, rangeScenario{
			Name:        d.name,
			SpeedKmh:    d.speedK,
			TempC:       d.tempC,
			EffWhKm:     math.Round(eff*10) / 10,
			RangeKm:     km,
			RangeMi:     mi,
			SampleCount: samples,
			Extras:      extras,
		})
	}

	// "Current Conditions" scenario using vehicle's outside temp
	currentTemp := 20
	if outsideTemp != nil {
		currentTemp = int(*outsideTemp)
	}
	currentTempBucket := tempBucketFor(currentTemp)
	currentEff := getEfficiency(lookup, currentTempBucket, "suburban")
	if currentEff <= 0 {
		currentEff = defaultEfficiency(currentTemp, 80)
	}
	km, mi := calcRange(currentEff)
	samples := 0
	if b, ok := lookup[currentTempBucket+"|suburban"]; ok {
		samples = b.Samples
	}
	scenarios = append(scenarios, rangeScenario{
		Name:        "Current Conditions",
		SpeedKmh:    80,
		TempC:       currentTemp,
		EffWhKm:     math.Round(currentEff*10) / 10,
		RangeKm:     km,
		RangeMi:     mi,
		SampleCount: samples,
		Extras:      []string{},
		IsCurrent:   true,
	})

	return scenarios
}

// GetByVehicle handles GET /vehicles/{vehicleID}/battery/projected-range
// Returns the ProjectedRangeData shape the frontend expects.
func (h *RangeProjectionHandler) GetByVehicle(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Look up vehicle-specific battery capacity
	var capacityWh float64
	if h.db != nil {
		capacityWh, _ = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	} else {
		capacityWh = 75000.0 // default Model 3/Y capacity
	}

	var batteryLevel, ratedRange, idealRange *float64
	if h.state != nil {
		now := time.Now()
		val, err := h.state.SignalAt(ctx, vehicleID, "BatteryLevel", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "BatteryLevel").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				batteryLevel = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "RatedRange", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "RatedRange").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				ratedRange = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "IdealBatteryRange", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "IdealBatteryRange").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if v, ok := signal.Float64(val); ok {
				idealRange = &v
			}
		}
	}

	bl := ptrF64(batteryLevel)
	rated := ptrF64(ratedRange)
	if rated == 0 {
		rated = ptrF64(idealRange)
	}
	if rated == 0 {
		rated = 500 // default Model Y rated range
	}

	newRange := rated // range when new at 100%
	currentRange := rated * bl / 100
	if bl == 0 {
		currentRange = rated
	}

	// Degradation estimate from canonical StateReader
	var healthPct *float64
	if h.state != nil {
		val, err := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", time.Now())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").Msg("range-projection: failed to read signal state")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read range projection state")
			return
		}
		if val != nil {
			if energy, ok := val.(float64); ok && energy > 0 {
				hp := (energy / capacityWh) * 100
				if hp > 100 {
					hp = 100
				}
				healthPct = &hp
			}
		}
	}

	degradation := 0.0
	healthScore := 100.0
	capacityPct := 100.0
	if healthPct != nil && *healthPct > 0 {
		healthScore = *healthPct
		degradation = 100 - *healthPct
		capacityPct = *healthPct
	}

	// Cycle estimate
	var totalCycles int
	var avgDailyKm float64
	if h.db != nil {
		if err := h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM charging_sessions WHERE vehicle_id = $1`, vehicleID).Scan(&totalCycles); err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: charging cycle count query failed")
		}

		// Avg daily km: distance_m / 1000 == km. Legacy emitted
		// the per-mile sum as `daily_km` (mislabeled mi-as-km); the SI
		// rewrite preserves the same numeric output by emitting miles via
		// `distance_m / $2`.
		if err := h.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(daily_km), 0) FROM (
			SELECT DATE(started_at) AS d, SUM(distance_m / $2) AS daily_km
			FROM drives WHERE vehicle_id = $1 AND distance_m > 0
			GROUP BY DATE(started_at)
		) sub`, vehicleID, driveStatsMetersPerMile).Scan(&avgDailyKm); err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("range-projection: avg daily km query failed")
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"current_range_km":     math.Round(currentRange*10) / 10,
		"new_range_km":         math.Round(newRange*10) / 10,
		"degradation_pct":      math.Round(degradation*10) / 10,
		"total_cycles":         totalCycles,
		"health_score":         math.Round(healthScore*10) / 10,
		"current_capacity_pct": math.Round(capacityPct*10) / 10,
		"avg_daily_km":         math.Round(avgDailyKm*10) / 10,
	})
}
