package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const nominalCapacity = 75.0

// RangeProjectionHandler serves projected range analytics.
type RangeProjectionHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
	redisCache      *signal.RedisSignalCache
}

func NewRangeProjectionHandler(db *database.DB, slr *database.SignalLogReader) *RangeProjectionHandler {
	return &RangeProjectionHandler{db: db, signalLogReader: slr}
}

// WithRedisCache sets the Redis signal cache for reading live vehicle state.
func (h *RangeProjectionHandler) WithRedisCache(cache *signal.RedisSignalCache) *RangeProjectionHandler {
	h.redisCache = cache
	return h
}

type rangeFactor struct {
	Name        string  `json:"name"`
	ImpactPct   float64 `json:"impact_pct"`
	Description string  `json:"description"`
}

type curvePoint struct {
	BatteryPct     int     `json:"battery_pct"`
	RatedRange     float64 `json:"rated_range"`
	ProjectedRange float64 `json:"projected_range"`
}

type efficiencyBucket struct {
	TempBucket  string  `json:"temp_bucket"`
	SpeedBucket string  `json:"speed_bucket"`
	WhKm        float64 `json:"wh_km"`
	Samples     int     `json:"samples"`
}

type rangeScenario struct {
	Name        string   `json:"name"`
	SpeedKmh    int      `json:"speed_kmh"`
	TempC       int      `json:"temp_c"`
	EffWhKm     float64  `json:"efficiency_wh_km"`
	RangeKm     float64  `json:"range_km"`
	RangeMi     float64  `json:"range_mi"`
	SampleCount int      `json:"sample_count"`
	Extras      []string `json:"extras"`
	IsCurrent   bool     `json:"is_current,omitempty"`
}

// Get handles GET /analytics/range-projection?vehicle_id=X
func (h *RangeProjectionHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Current battery state from signal_log
	var batteryLevel, estRange, ratedRange, idealRange *float64
	if h.signalLogReader != nil {
		now := time.Now()
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "BatteryLevel", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				batteryLevel = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EstBatteryRange", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				estRange = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "RatedRange", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				ratedRange = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "IdealBatteryRange", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
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

	// Recent driving efficiency
	var avgEffWhKm *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(
			CASE WHEN distance_mi > 0 THEN
				COALESCE(energy_used_kwh, 0) * 1000
				/ NULLIF(distance_mi * 1.60934, 0)
			END
		)
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 1
		ORDER BY start_ts DESC LIMIT 30`, vehicleID).Scan(&avgEffWhKm)

	var avgTempC *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(outside_temp_avg_c)
		FROM drives
		WHERE vehicle_id = $1 AND outside_temp_avg_c IS NOT NULL
		  AND start_ts > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgTempC)

	var avgSpeedKmh *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(avg_speed_mph)
		FROM drives
		WHERE vehicle_id = $1 AND avg_speed_mph IS NOT NULL AND avg_speed_mph > 0
		  AND start_ts > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgSpeedKmh)

	// ── Efficiency matrix ────────────────────────────────
	matrix := h.buildEfficiencyMatrix(ctx, vehicleID)

	// ── Battery health / degradation adjustment ──────────
	var healthScore *float64
	if h.signalLogReader != nil {
		val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EnergyRemaining", time.Now())
		if err == nil && val != nil {
			if energy, ok := val.(float64); ok && energy > 0 {
				hs := (energy / nominalCapacity) * 100
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
	usableCapacity := nominalCapacity * healthFactor

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
	if bl > 0 && bl < 100 {
		rated = rated * bl / 100
		projectedRange = projectedRange * bl / 100
	}

	ratedAt100 := rated
	if bl > 0 {
		ratedAt100 = rated / bl * 100
	}
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
	teslaEstKm := rated
	yourEstKm := projectedRange

	// Sample count
	var totalDrives int
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM drives WHERE vehicle_id = $1 AND distance_mi > 5 AND start_battery_pct > end_battery_pct`,
		vehicleID).Scan(&totalDrives)

	// First drive date for accuracy note
	var firstDrive *time.Time
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT MIN(start_ts) FROM drives WHERE vehicle_id = $1 AND distance_mi > 0`,
		vehicleID).Scan(&firstDrive)
	monthsOfData := 0
	if firstDrive != nil {
		monthsOfData = int(time.Since(*firstDrive).Hours() / (24 * 30.44))
	}

	accuracyNote := fmt.Sprintf("Based on %d drives", totalDrives)
	if monthsOfData > 0 {
		accuracyNote = fmt.Sprintf("Based on %d drives over %d months", totalDrives, monthsOfData)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		// Original fields (backward compatible)
		"current_range_km":   math.Round(rated*10) / 10,
		"projected_range_km": math.Round(projectedRange*10) / 10,
		"battery_level":      math.Round(bl*10) / 10,
		"efficiency_factor":  math.Round(effFactor*1000) / 1000,
		"factors":            factors,
		"projection_curve":   curve,
		// Enhanced fields
		"current_battery_pct":  math.Round(bl*10) / 10,
		"usable_capacity_kwh":  math.Round(usableCapacity*10) / 10,
		"health_factor":        math.Round(healthFactor*1000) / 1000,
		"scenarios":            scenarios,
		"efficiency_matrix":    matrix,
		"tesla_estimate_km":    math.Round(teslaEstKm*10) / 10,
		"your_estimate_km":     math.Round(yourEstKm*10) / 10,
		"accuracy_note":        accuracyNote,
	})
}

// ── Efficiency matrix ────────────────────────────────────────

func (h *RangeProjectionHandler) buildEfficiencyMatrix(ctx context.Context, vehicleID int64) []efficiencyBucket {
	rows, err := h.db.Pool.Query(ctx, `
		SELECT
			CASE
				WHEN outside_temp_avg_c < 0 THEN 'freezing'
				WHEN outside_temp_avg_c < 10 THEN 'cold'
				WHEN outside_temp_avg_c < 25 THEN 'mild'
				ELSE 'hot'
			END AS temp_bucket,
			CASE
				WHEN avg_speed_mph < 50 THEN 'city'
				WHEN avg_speed_mph < 90 THEN 'suburban'
				ELSE 'highway'
			END AS speed_bucket,
			AVG((start_battery_pct - end_battery_pct) * $2 * 10 / NULLIF(distance_mi, 0)) AS wh_per_km,
			COUNT(*) AS sample_count
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 5 AND start_battery_pct > end_battery_pct
		  AND outside_temp_avg_c IS NOT NULL AND avg_speed_mph IS NOT NULL
		GROUP BY temp_bucket, speed_bucket
		HAVING COUNT(*) >= 3`,
		vehicleID, nominalCapacity)
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

func (h *RangeProjectionHandler) buildScenarios(matrix []efficiencyBucket, batteryPct, usableCapKWh float64, outsideTemp *float64) []rangeScenario {
	lookup := make(map[string]efficiencyBucket)
	for _, b := range matrix {
		lookup[b.TempBucket+"|"+b.SpeedBucket] = b
	}

	calcRange := func(effWhKm float64) (km, mi float64) {
		if effWhKm <= 0 {
			return 0, 0
		}
		km = usableCapKWh * 1000 * (batteryPct / 100) / effWhKm
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

func getEfficiency(lookup map[string]efficiencyBucket, temp, speed string) float64 {
	if b, ok := lookup[temp+"|"+speed]; ok {
		return b.WhKm
	}
	return 0
}

func tempBucketFor(tempC int) string {
	switch {
	case tempC < 0:
		return "freezing"
	case tempC < 10:
		return "cold"
	case tempC < 25:
		return "mild"
	default:
		return "hot"
	}
}

func defaultEfficiency(tempC, speedKmh int) float64 {
	base := 155.0 // mild city baseline
	if speedKmh > 90 {
		base = 195
	} else if speedKmh > 50 {
		base = 170
	}
	if tempC < 0 {
		base *= 1.35
	} else if tempC < 10 {
		base *= 1.15
	} else if tempC > 35 {
		base *= 1.08
	}
	return base
}

func buildRangeFactors(avgTemp, avgSpeed, avgEff *float64) []rangeFactor {
	var factors []rangeFactor

	// Temperature impact
	if avgTemp != nil {
		temp := *avgTemp
		impact := 0.0
		desc := "Moderate temperature, minimal impact"
		if temp < 0 {
			impact = -20
			desc = "Cold weather significantly reduces range"
		} else if temp < 10 {
			impact = -10
			desc = "Cool weather moderately reduces range"
		} else if temp > 35 {
			impact = -8
			desc = "High heat increases cooling load"
		} else if temp >= 15 && temp <= 25 {
			impact = 2
			desc = "Ideal temperature for battery efficiency"
		}
		factors = append(factors, rangeFactor{
			Name: "temperature", ImpactPct: impact, Description: desc,
		})
	}

	// Speed impact
	if avgSpeed != nil {
		speed := *avgSpeed
		impact := 0.0
		desc := "Moderate speed, good efficiency"
		if speed > 120 {
			impact = -15
			desc = "High-speed driving greatly reduces range"
		} else if speed > 100 {
			impact = -8
			desc = "Highway speed reduces range moderately"
		} else if speed < 50 {
			impact = 5
			desc = "Low-speed city driving improves range"
		}
		factors = append(factors, rangeFactor{
			Name: "speed", ImpactPct: impact, Description: desc,
		})
	}

	// HVAC estimate
	factors = append(factors, rangeFactor{
		Name: "hvac", ImpactPct: -3, Description: "Climate control active",
	})

	// Driving style from efficiency
	if avgEff != nil {
		eff := *avgEff
		impact := 0.0
		desc := "Average driving style"
		if eff < 140 {
			impact = 5
			desc = "Efficient driving style"
		} else if eff > 200 {
			impact = -10
			desc = "Aggressive driving reduces range"
		} else if eff > 170 {
			impact = -5
			desc = "Moderately aggressive driving"
		}
		factors = append(factors, rangeFactor{
			Name: "driving_style", ImpactPct: impact, Description: desc,
		})
	}

	// Elevation placeholder
	factors = append(factors, rangeFactor{
		Name: "elevation", ImpactPct: -1, Description: "Minor elevation changes",
	})

	return factors
}

func ptrF64(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// GetByVehicle handles GET /vehicles/{vehicleID}/battery/projected-range
// Returns the ProjectedRangeData shape the frontend expects.
func (h *RangeProjectionHandler) GetByVehicle(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var batteryLevel, ratedRange, idealRange *float64
	if h.signalLogReader != nil {
		now := time.Now()
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "BatteryLevel", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				batteryLevel = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "RatedRange", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				ratedRange = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "IdealBatteryRange", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
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

	// Degradation estimate from signal_log
	var healthPct *float64
	if h.signalLogReader != nil {
		val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EnergyRemaining", time.Now())
		if err == nil && val != nil {
			if energy, ok := val.(float64); ok && energy > 0 {
				hp := (energy / nominalCapacity) * 100
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
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM charging_sessions WHERE vehicle_id = $1`, vehicleID).Scan(&totalCycles)

	// Avg daily km
	var avgDailyKm float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(daily_km), 0) FROM (
			SELECT DATE(start_ts) AS d, SUM(distance_mi) AS daily_km
			FROM drives WHERE vehicle_id = $1 AND distance_mi > 0
			GROUP BY DATE(start_ts)
		) sub`, vehicleID).Scan(&avgDailyKm)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"current_range_km":   math.Round(currentRange*10) / 10,
		"new_range_km":       math.Round(newRange*10) / 10,
		"degradation_pct":    math.Round(degradation*10) / 10,
		"total_cycles":       totalCycles,
		"health_score":       math.Round(healthScore*10) / 10,
		"current_capacity_pct": math.Round(capacityPct*10) / 10,
		"avg_daily_km":       math.Round(avgDailyKm*10) / 10,
	})
}
