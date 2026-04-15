package api

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// RangeProjectionHandler serves projected range analytics.
type RangeProjectionHandler struct {
	db *database.DB
}

func NewRangeProjectionHandler(db *database.DB) *RangeProjectionHandler {
	return &RangeProjectionHandler{db: db}
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

	// Current battery state from charging_telemetry
	var batteryLevel, estRange, ratedRange, idealRange *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT battery_level, est_battery_range, rated_range, ideal_battery_range
		FROM charging_telemetry
		WHERE vehicle_id = $1
			AND (battery_level IS NOT NULL OR est_battery_range IS NOT NULL)
		ORDER BY created_at DESC LIMIT 1`, vehicleID).Scan(&batteryLevel, &estRange, &ratedRange, &idealRange)

	// Recent driving efficiency (Wh/km from last 30 drives)
	var avgEffWhKm *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(
			CASE WHEN distance > 0 THEN
				(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0))
				/ NULLIF(distance, 0) * 1000
			END
		)
		FROM drives
		WHERE vehicle_id = $1 AND distance > 1
		ORDER BY start_date DESC LIMIT 30`, vehicleID).Scan(&avgEffWhKm)

	// Average outside temp from recent drives
	var avgTempC *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(outside_temp_avg)
		FROM drives
		WHERE vehicle_id = $1 AND outside_temp_avg IS NOT NULL
		  AND start_date > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgTempC)

	// Average speed from recent drives
	var avgSpeedKmh *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(speed_avg)
		FROM drives
		WHERE vehicle_id = $1 AND speed_avg IS NOT NULL AND speed_avg > 0
		  AND start_date > NOW() - INTERVAL '30 days'`, vehicleID).Scan(&avgSpeedKmh)

	// Build response
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

	// Efficiency factor: ratio of real-world range to rated range
	effFactor := 1.0
	if rated > 0 && est > 0 {
		effFactor = est / rated
	}

	// Build factors that affect range
	factors := buildRangeFactors(avgTempC, avgSpeedKmh, avgEffWhKm)

	// Total impact adjusts efficiency factor
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

	// Build projection curve
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"current_range_km":   math.Round(rated*10) / 10,
		"projected_range_km": math.Round(projectedRange*10) / 10,
		"battery_level":      math.Round(bl*10) / 10,
		"efficiency_factor":  math.Round(effFactor*1000) / 1000,
		"factors":            factors,
		"projection_curve":   curve,
	})
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
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT battery_level, rated_range, ideal_battery_range
		FROM charging_telemetry
		WHERE vehicle_id = $1 AND battery_level IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`, vehicleID).Scan(&batteryLevel, &ratedRange, &idealRange)

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

	// Degradation estimate from battery snapshots
	var healthPct *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT battery_health_pct FROM battery_snapshots
		WHERE vehicle_id = $1 AND battery_health_pct IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`, vehicleID).Scan(&healthPct)

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
			SELECT DATE(start_date) AS d, SUM(distance) AS daily_km
			FROM drives WHERE vehicle_id = $1 AND distance > 0
			GROUP BY DATE(start_date)
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
