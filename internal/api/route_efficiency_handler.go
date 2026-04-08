package api

import (
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// RouteEfficiencyHandler serves route-efficiency analytics.
type RouteEfficiencyHandler struct {
	db *database.DB
}

func NewRouteEfficiencyHandler(db *database.DB) *RouteEfficiencyHandler {
	return &RouteEfficiencyHandler{db: db}
}

type routeSummary struct {
	StartLocation  string  `json:"start_location"`
	EndLocation    string  `json:"end_location"`
	TripCount      int     `json:"trip_count"`
	AvgDistanceKm  float64 `json:"avg_distance_km"`
	AvgDurationMin float64 `json:"avg_duration_min"`
	AvgEfficiency  float64 `json:"avg_efficiency"`
	BestEfficiency float64 `json:"best_efficiency"`
	WorstEfficiency float64 `json:"worst_efficiency"`
	AvgSpeed       float64 `json:"avg_speed"`
	AvgTemp        float64 `json:"avg_temp"`
}

type routeDriveDetail struct {
	ID              int64   `json:"id"`
	StartDate       string  `json:"start_date"`
	Distance        float64 `json:"distance"`
	DurationMin     float64 `json:"duration_min"`
	SpeedAvg        float64 `json:"speed_avg"`
	StartBattery    int     `json:"start_battery_level"`
	EndBattery      int     `json:"end_battery_level"`
	OutsideTempAvg  float64 `json:"outside_temp_avg"`
	Efficiency      float64 `json:"efficiency"`
}

// List returns the top routes grouped by start→end address pair.
func (h *RouteEfficiencyHandler) List(w http.ResponseWriter, r *http.Request) {
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

	rows, err := h.db.Pool.Query(ctx, `
		SELECT
		  start_address as start_location,
		  end_address as end_location,
		  COUNT(*) as trip_count,
		  AVG(distance) as avg_distance_km,
		  AVG(duration_min) as avg_duration_min,
		  AVG(CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END) as avg_efficiency,
		  MIN(CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END) as best_efficiency,
		  MAX(CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END) as worst_efficiency,
		  AVG(speed_avg) as avg_speed,
		  AVG(outside_temp_avg) as avg_temp
		FROM drives
		WHERE vehicle_id = $1
		  AND start_address IS NOT NULL AND end_address IS NOT NULL
		  AND distance > 1
		GROUP BY start_address, end_address
		HAVING COUNT(*) >= 1
		ORDER BY COUNT(*) DESC
		LIMIT 15`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("route efficiency: failed to query routes")
		writeError(w, http.StatusInternalServerError, "failed to query route efficiency")
		return
	}
	defer rows.Close()

	var routes []routeSummary
	for rows.Next() {
		var rs routeSummary
		var avgDist, avgDur, avgEff, bestEff, worstEff, avgSpd, avgTemp *float64
		if err := rows.Scan(&rs.StartLocation, &rs.EndLocation, &rs.TripCount,
			&avgDist, &avgDur, &avgEff, &bestEff, &worstEff, &avgSpd, &avgTemp); err != nil {
			log.Error().Err(err).Msg("route efficiency: scan route row")
			writeError(w, http.StatusInternalServerError, "failed to scan route data")
			return
		}
		if avgDist != nil {
			rs.AvgDistanceKm = math.Round(*avgDist*100) / 100
		}
		if avgDur != nil {
			rs.AvgDurationMin = math.Round(*avgDur*100) / 100
		}
		if avgEff != nil {
			rs.AvgEfficiency = math.Round(*avgEff*100) / 100
		}
		if bestEff != nil {
			rs.BestEfficiency = math.Round(*bestEff*100) / 100
		}
		if worstEff != nil {
			rs.WorstEfficiency = math.Round(*worstEff*100) / 100
		}
		if avgSpd != nil {
			rs.AvgSpeed = math.Round(*avgSpd*10) / 10
		}
		if avgTemp != nil {
			rs.AvgTemp = math.Round(*avgTemp*10) / 10
		}
		routes = append(routes, rs)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("route efficiency: routes rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read route data")
		return
	}

	if routes == nil {
		routes = []routeSummary{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"routes": routes,
	})
}

// Detail returns per-trip details for a specific start→end route.
func (h *RouteEfficiencyHandler) Detail(w http.ResponseWriter, r *http.Request) {
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

	startAddr := r.URL.Query().Get("start")
	endAddr := r.URL.Query().Get("end")
	if startAddr == "" || endAddr == "" {
		writeError(w, http.StatusBadRequest, "start and end query parameters required")
		return
	}

	ctx := r.Context()

	rows, err := h.db.Pool.Query(ctx, `
		SELECT id, start_date, distance, duration_min, speed_avg,
		  start_battery_level, end_battery_level, outside_temp_avg,
		  CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END as efficiency
		FROM drives
		WHERE vehicle_id = $1
		  AND start_address = $2 AND end_address = $3
		  AND distance > 1
		ORDER BY start_date DESC
		LIMIT 20`, vehicleID, startAddr, endAddr)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).
			Str("start", startAddr).Str("end", endAddr).
			Msg("route efficiency: failed to query route detail")
		writeError(w, http.StatusInternalServerError, "failed to query route detail")
		return
	}
	defer rows.Close()

	var drives []routeDriveDetail
	for rows.Next() {
		var d routeDriveDetail
		var startDate time.Time
		var spdAvg, tempAvg, eff *float64
		var startBat, endBat *int
		if err := rows.Scan(&d.ID, &startDate, &d.Distance, &d.DurationMin,
			&spdAvg, &startBat, &endBat, &tempAvg, &eff); err != nil {
			log.Error().Err(err).Msg("route efficiency: scan detail row")
			writeError(w, http.StatusInternalServerError, "failed to scan route detail")
			return
		}
		d.StartDate = startDate.Format(time.RFC3339)
		d.Distance = math.Round(d.Distance*100) / 100
		d.DurationMin = math.Round(d.DurationMin*100) / 100
		if spdAvg != nil {
			d.SpeedAvg = math.Round(*spdAvg*10) / 10
		}
		if startBat != nil {
			d.StartBattery = *startBat
		}
		if endBat != nil {
			d.EndBattery = *endBat
		}
		if tempAvg != nil {
			d.OutsideTempAvg = math.Round(*tempAvg*10) / 10
		}
		if eff != nil {
			d.Efficiency = math.Round(*eff*100) / 100
		}
		drives = append(drives, d)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("route efficiency: detail rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read route detail")
		return
	}

	if drives == nil {
		drives = []routeDriveDetail{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"drives": drives,
	})
}
