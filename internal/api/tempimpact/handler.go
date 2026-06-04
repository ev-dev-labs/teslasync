package tempimpact

import (
	"math"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

const (
	driveStatsMetersPerMile  = 1609.344
	driveStatsTwoMilesMeters = 2.0 * driveStatsMetersPerMile
)

// Handler serves temperature-impact analytics.
type Handler struct {
	db *database.DB
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}

type tempEfficiencyBucket struct {
	TempBucket         string  `json:"temp_bucket"`
	DriveCount         int     `json:"drive_count"`
	AvgDistanceKm      float64 `json:"avg_distance_km"`
	AvgDurationS       float64 `json:"avg_duration_s"`
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
	TotalDistance float64 `json:"total_distance"`
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Drives are stored in SI; SQL converts only the legacy km response fields.
	effRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN ambient_temp_c_avg < 0 THEN 'Below 0°C'
		    WHEN ambient_temp_c_avg < 10 THEN '0-10°C'
		    WHEN ambient_temp_c_avg < 20 THEN '10-20°C'
		    WHEN ambient_temp_c_avg < 30 THEN '20-30°C'
		    ELSE 'Above 30°C'
		  END as temp_bucket,
		  COUNT(*) as drive_count,
		  AVG(distance_m / 1000.0) as avg_distance_km,
		  AVG(duration_s) as avg_duration_s,
		  AVG(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as avg_battery_pct_per_100km,
		  AVG(ambient_temp_c_avg) as avg_temp
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		GROUP BY temp_bucket
		ORDER BY MIN(ambient_temp_c_avg)`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query efficiency buckets")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query temperature efficiency")
		return
	}
	defer effRows.Close()

	var efficiency []tempEfficiencyBucket
	for effRows.Next() {
		var b tempEfficiencyBucket
		var avgDist, avgDur, avgBat, avgTemp *float64
		if err := effRows.Scan(&b.TempBucket, &b.DriveCount, &avgDist, &avgDur, &avgBat, &avgTemp); err != nil {
			log.Error().Err(err).Msg("temp impact: scan efficiency row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan temperature efficiency")
			return
		}
		if avgDist != nil {
			b.AvgDistanceKm = math.Round(*avgDist*100) / 100
		}
		if avgDur != nil {
			b.AvgDurationS = math.Round(*avgDur*100) / 100
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read temperature efficiency")
		return
	}

	// vampire_drain_events no longer exists; keep the response key empty until signal_log reconstruction exists.
	vampireDrain := make([]vampireDrainBucket, 0)

	// SQL returns distance in km to preserve the legacy total_distance response semantics.
	trendRows, err := h.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', started_at) as month,
		       AVG(ambient_temp_c_avg) as avg_temp,
		       AVG(CASE WHEN distance_m > 0
		                THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		                ELSE 0 END) as avg_efficiency,
		       COUNT(*) as drive_count,
		       SUM(distance_m / 1000.0) as total_distance
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		  AND started_at > NOW() - interval '12 months'
		GROUP BY month
		ORDER BY month`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query monthly trend")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query monthly trend")
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
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan monthly trend")
			return
		}
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read monthly trend")
		return
	}

	if efficiency == nil {
		efficiency = []tempEfficiencyBucket{}
	}
	if monthlyTrend == nil {
		monthlyTrend = []monthlyTempTrend{}
	}

	type drivePoint struct {
		OutsideTemp    float64 `json:"outside_temp"`
		EfficiencyWhKm float64 `json:"efficiency_wh_km"`
		DistanceKm     float64 `json:"distance_km"`
		DriveDate      string  `json:"drive_date"`
	}

	// distance_km is derived in SQL from SI distance_m.
	pointRows, err := h.db.Pool.Query(ctx, `
		SELECT ambient_temp_c_avg,
		       CASE WHEN distance_m > 0
		            THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100 * 0.75
		            ELSE 0 END as efficiency_wh_km,
		       distance_m / 1000.0 as distance_km,
		       started_at::date
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		ORDER BY started_at DESC
		LIMIT 500`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
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
			if temp != nil {
				p.OutsideTemp = math.Round(*temp*10) / 10
			}
			if eff != nil {
				p.EfficiencyWhKm = math.Round(*eff*10) / 10
			}
			if dist != nil {
				p.DistanceKm = math.Round(*dist*10) / 10
			}
			if dt, ok := driveDate.(interface{ Format(string) string }); ok {
				p.DriveDate = dt.Format("2006-01-02")
			}
			points = append(points, p)
		}
	}
	if points == nil {
		points = []drivePoint{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"points":        points,
		"efficiency":    efficiency,
		"vampire_drain": vampireDrain,
		"monthly_trend": monthlyTrend,
	})
}
