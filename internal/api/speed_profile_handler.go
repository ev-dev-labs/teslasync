package api

import (
	"math"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SpeedProfileHandler serves speed-distribution and efficiency analytics.
type SpeedProfileHandler struct {
	db *database.DB
}

func NewSpeedProfileHandler(db *database.DB) *SpeedProfileHandler {
	return &SpeedProfileHandler{db: db}
}

type speedBucket struct {
	SpeedBucket string  `json:"speed_bucket"`
	Readings    int     `json:"readings"`
	AvgPowerKW  float64 `json:"avg_power_kw"`
}

type efficiencyCategory struct {
	Category        string  `json:"category"`
	DriveCount      int     `json:"drive_count"`
	AvgSpeed        float64 `json:"avg_speed"`
	BatteryPer100km float64 `json:"battery_pct_per_100km"`
}

type efficiencyPoint struct {
	SpeedAvg   float64 `json:"avg_speed_mph"`
	Distance   float64 `json:"distance"`
	Efficiency float64 `json:"efficiency"`
}

func (h *SpeedProfileHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	// Speed distribution from signal_log (VehicleSpeed)
	distRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN value_num < 15 THEN '0-15'
		    WHEN value_num < 30 THEN '15-30'
		    WHEN value_num < 45 THEN '30-45'
		    WHEN value_num < 60 THEN '45-60'
		    WHEN value_num < 75 THEN '60-75'
		    ELSE '75+'
		  END AS speed_bucket,
		  COUNT(*) AS readings,
		  0 AS avg_power_kw
		FROM signal_log
		WHERE vehicle_id = $1 AND signal = 'VehicleSpeed'
		  AND value_num IS NOT NULL AND value_num > 0
		  AND created_at > NOW() - INTERVAL '30 days'
		GROUP BY speed_bucket
		ORDER BY MIN(value_num)`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query distribution")
		writeError(w, http.StatusInternalServerError, "failed to query speed distribution")
		return
	}
	defer distRows.Close()

	var distribution []speedBucket
	for distRows.Next() {
		var b speedBucket
		if err := distRows.Scan(&b.SpeedBucket, &b.Readings, &b.AvgPowerKW); err != nil {
			log.Error().Err(err).Msg("speed profile: scan distribution row")
			writeError(w, http.StatusInternalServerError, "failed to scan speed distribution")
			return
		}
		b.AvgPowerKW = math.Round(b.AvgPowerKW*100) / 100
		distribution = append(distribution, b)
	}
	if err := distRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: distribution rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read speed distribution")
		return
	}

	// Efficiency by speed category
	catRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN avg_speed_mph < 30 THEN 'City (<30)'
		    WHEN avg_speed_mph < 60 THEN 'Suburban (30-60)'
		    WHEN avg_speed_mph < 90 THEN 'Highway (60-90)'
		    ELSE 'High Speed (90+)'
		  END AS category,
		  COUNT(*) AS drive_count,
		  AVG(distance_mi / NULLIF(duration_min,0) * 60) AS avg_speed,
		  AVG(CASE WHEN distance_mi > 0 THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 ELSE 0 END) AS battery_pct_per_100km
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 1 AND duration_min > 1
		  AND start_ts > NOW() - interval '90 days'
		GROUP BY category`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency categories")
		writeError(w, http.StatusInternalServerError, "failed to query efficiency categories")
		return
	}
	defer catRows.Close()

	var categories []efficiencyCategory
	for catRows.Next() {
		var c efficiencyCategory
		var avgSpd, batPer *float64
		if err := catRows.Scan(&c.Category, &c.DriveCount, &avgSpd, &batPer); err != nil {
			log.Error().Err(err).Msg("speed profile: scan category row")
			writeError(w, http.StatusInternalServerError, "failed to scan efficiency categories")
			return
		}
		if avgSpd != nil {
			c.AvgSpeed = math.Round(*avgSpd*10) / 10
		}
		if batPer != nil {
			c.BatteryPer100km = math.Round(*batPer*100) / 100
		}
		categories = append(categories, c)
	}
	if err := catRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: category rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read efficiency categories")
		return
	}

	// Optimal speed data points
	ptRows, err := h.db.Pool.Query(ctx, `
		SELECT avg_speed_mph, distance_mi,
		  CASE WHEN distance_mi > 0 THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 ELSE 0 END AS efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 5 AND duration_min > 5
		  AND avg_speed_mph IS NOT NULL
		ORDER BY start_ts DESC LIMIT 100`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency points")
		writeError(w, http.StatusInternalServerError, "failed to query efficiency points")
		return
	}
	defer ptRows.Close()

	var points []efficiencyPoint
	for ptRows.Next() {
		var p efficiencyPoint
		if err := ptRows.Scan(&p.SpeedAvg, &p.Distance, &p.Efficiency); err != nil {
			log.Error().Err(err).Msg("speed profile: scan efficiency point")
			writeError(w, http.StatusInternalServerError, "failed to scan efficiency points")
			return
		}
		p.SpeedAvg = math.Round(p.SpeedAvg*10) / 10
		p.Distance = math.Round(p.Distance*100) / 100
		p.Efficiency = math.Round(p.Efficiency*100) / 100
		points = append(points, p)
	}
	if err := ptRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: efficiency points iteration")
		writeError(w, http.StatusInternalServerError, "failed to read efficiency points")
		return
	}

	if distribution == nil {
		distribution = []speedBucket{}
	}
	if categories == nil {
		categories = []efficiencyCategory{}
	}
	if points == nil {
		points = []efficiencyPoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"distribution": distribution,
		"categories":   categories,
		"points":       points,
	})
}
