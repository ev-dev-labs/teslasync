package api

import (
	"math"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TempImpactHandler serves temperature-impact analytics.
type TempImpactHandler struct {
	db *database.DB
}

func NewTempImpactHandler(db *database.DB) *TempImpactHandler {
	return &TempImpactHandler{db: db}
}

type tempEfficiencyBucket struct {
	TempBucket         string  `json:"temp_bucket"`
	DriveCount         int     `json:"drive_count"`
	AvgDistanceKm      float64 `json:"avg_distance_km"`
	AvgDurationMin     float64 `json:"avg_duration_min"`
	AvgBatteryPer100km float64 `json:"avg_battery_pct_per_100km"`
	AvgTemp            float64 `json:"avg_temp"`
}

type vampireDrainBucket struct {
	TempBucket   string  `json:"temp_bucket"`
	AvgDrainRate float64 `json:"avg_drain_rate"`
	EventCount   int     `json:"event_count"`
}

type monthlyTempTrend struct {
	Month         string  `json:"month"`
	AvgTemp       float64 `json:"avg_temp"`
	AvgEfficiency float64 `json:"avg_efficiency"`
	DriveCount    int     `json:"drive_count"`
	TotalDistance  float64 `json:"total_distance"`
}

func (h *TempImpactHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Efficiency by temperature bucket
	effRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN outside_temp_avg_c < 0 THEN 'Below 0°C'
		    WHEN outside_temp_avg_c < 10 THEN '0-10°C'
		    WHEN outside_temp_avg_c < 20 THEN '10-20°C'
		    WHEN outside_temp_avg_c < 30 THEN '20-30°C'
		    ELSE 'Above 30°C'
		  END as temp_bucket,
		  COUNT(*) as drive_count,
		  AVG(distance_mi) as avg_distance_km,
		  AVG(duration_min) as avg_duration_min,
		  AVG(CASE WHEN distance_mi > 0 THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 ELSE 0 END) as avg_battery_pct_per_100km,
		  AVG(outside_temp_avg_c) as avg_temp
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 2 AND outside_temp_avg_c IS NOT NULL
		GROUP BY temp_bucket
		ORDER BY MIN(outside_temp_avg_c)`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query efficiency buckets")
		writeError(w, http.StatusInternalServerError, "failed to query temperature efficiency")
		return
	}
	defer effRows.Close()

	var efficiency []tempEfficiencyBucket
	for effRows.Next() {
		var b tempEfficiencyBucket
		var avgDist, avgDur, avgBat, avgTemp *float64
		if err := effRows.Scan(&b.TempBucket, &b.DriveCount, &avgDist, &avgDur, &avgBat, &avgTemp); err != nil {
			log.Error().Err(err).Msg("temp impact: scan efficiency row")
			writeError(w, http.StatusInternalServerError, "failed to scan temperature efficiency")
			return
		}
		if avgDist != nil {
			b.AvgDistanceKm = math.Round(*avgDist*100) / 100
		}
		if avgDur != nil {
			b.AvgDurationMin = math.Round(*avgDur*100) / 100
		}
		if avgBat != nil {
			b.AvgBatteryPer100km = math.Round(*avgBat*100) / 100
		}
		if avgTemp != nil {
			b.AvgTemp = math.Round(*avgTemp*10) / 10
		}
		efficiency = append(efficiency, b)
	}
	if err := effRows.Err(); err != nil {
		log.Error().Err(err).Msg("temp impact: efficiency rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read temperature efficiency")
		return
	}

	// Vampire drain vs temperature
	drainRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN outside_temp_avg < 0 THEN 'Below 0°C'
		    WHEN outside_temp_avg < 10 THEN '0-10°C'
		    WHEN outside_temp_avg < 20 THEN '10-20°C'
		    WHEN outside_temp_avg < 30 THEN '20-30°C'
		    ELSE 'Above 30°C'
		  END as temp_bucket,
		  AVG(drain_rate_pct_per_hour) as avg_drain_rate,
		  COUNT(*) as event_count
		FROM vampire_drain_events
		WHERE vehicle_id = $1 AND outside_temp_avg IS NOT NULL
		GROUP BY temp_bucket
		ORDER BY MIN(outside_temp_avg)`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query vampire drain")
		writeError(w, http.StatusInternalServerError, "failed to query vampire drain by temperature")
		return
	}
	defer drainRows.Close()

	var vampireDrain []vampireDrainBucket
	for drainRows.Next() {
		var b vampireDrainBucket
		var avgDrain *float64
		if err := drainRows.Scan(&b.TempBucket, &avgDrain, &b.EventCount); err != nil {
			log.Error().Err(err).Msg("temp impact: scan vampire drain row")
			writeError(w, http.StatusInternalServerError, "failed to scan vampire drain data")
			return
		}
		if avgDrain != nil {
			b.AvgDrainRate = math.Round(*avgDrain*100) / 100
		}
		vampireDrain = append(vampireDrain, b)
	}
	if err := drainRows.Err(); err != nil {
		log.Error().Err(err).Msg("temp impact: vampire drain rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read vampire drain data")
		return
	}

	// Monthly temperature + efficiency trend
	trendRows, err := h.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', start_ts) as month,
		       AVG(outside_temp_avg_c) as avg_temp,
		       AVG(CASE WHEN distance_mi > 0 THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 ELSE 0 END) as avg_efficiency,
		       COUNT(*) as drive_count,
		       SUM(distance_mi) as total_distance
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 2 AND outside_temp_avg_c IS NOT NULL
		  AND start_ts > NOW() - interval '12 months'
		GROUP BY month
		ORDER BY month`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query monthly trend")
		writeError(w, http.StatusInternalServerError, "failed to query monthly trend")
		return
	}
	defer trendRows.Close()

	var monthlyTrend []monthlyTempTrend
	for trendRows.Next() {
		var t monthlyTempTrend
		var monthTime interface{}
		var avgTemp, avgEff, totalDist *float64
		if err := trendRows.Scan(&monthTime, &avgTemp, &avgEff, &t.DriveCount, &totalDist); err != nil {
			log.Error().Err(err).Msg("temp impact: scan monthly trend row")
			writeError(w, http.StatusInternalServerError, "failed to scan monthly trend")
			return
		}
		// DATE_TRUNC returns a time.Time; format to "2006-01"
		if mt, ok := monthTime.(interface{ Format(string) string }); ok {
			t.Month = mt.Format("2006-01")
		}
		if avgTemp != nil {
			t.AvgTemp = math.Round(*avgTemp*10) / 10
		}
		if avgEff != nil {
			t.AvgEfficiency = math.Round(*avgEff*100) / 100
		}
		if totalDist != nil {
			t.TotalDistance = math.Round(*totalDist*10) / 10
		}
		monthlyTrend = append(monthlyTrend, t)
	}
	if err := trendRows.Err(); err != nil {
		log.Error().Err(err).Msg("temp impact: monthly trend rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read monthly trend")
		return
	}

	if efficiency == nil {
		efficiency = []tempEfficiencyBucket{}
	}
	if vampireDrain == nil {
		vampireDrain = []vampireDrainBucket{}
	}
	if monthlyTrend == nil {
		monthlyTrend = []monthlyTempTrend{}
	}

	// Per-drive scatter data for the frontend
	type drivePoint struct {
		OutsideTemp    float64 `json:"outside_temp"`
		EfficiencyWhKm float64 `json:"efficiency_wh_km"`
		DistanceKm     float64 `json:"distance_km"`
		DriveDate      string  `json:"drive_date"`
	}

	pointRows, err := h.db.Pool.Query(ctx, `
		SELECT outside_temp_avg_c,
		       CASE WHEN distance_mi > 0 THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 * 0.75 ELSE 0 END as efficiency_wh_km,
		       distance_mi,
		       start_ts::date
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 2 AND outside_temp_avg_c IS NOT NULL
		ORDER BY start_ts DESC
		LIMIT 500`, vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("temp impact: failed to query drive points")
	}

	var points []drivePoint
	if pointRows != nil {
		defer pointRows.Close()
		for pointRows.Next() {
			var p drivePoint
			var temp, eff, dist *float64
			var driveDate interface{}
			if err := pointRows.Scan(&temp, &eff, &dist, &driveDate); err != nil {
				continue
			}
			if temp != nil { p.OutsideTemp = math.Round(*temp*10) / 10 }
			if eff != nil { p.EfficiencyWhKm = math.Round(*eff*10) / 10 }
			if dist != nil { p.DistanceKm = math.Round(*dist*10) / 10 }
			if dt, ok := driveDate.(interface{ Format(string) string }); ok {
				p.DriveDate = dt.Format("2006-01-02")
			}
			points = append(points, p)
		}
	}
	if points == nil {
		points = []drivePoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"points":        points,
		"efficiency":    efficiency,
		"vampire_drain": vampireDrain,
		"monthly_trend": monthlyTrend,
	})
}
