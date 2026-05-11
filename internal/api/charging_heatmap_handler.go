package api

import (
	"math"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// ChargingHeatmapHandler serves aggregated charging-pattern analytics.
type ChargingHeatmapHandler struct {
	db *database.DB
}

func NewChargingHeatmapHandler(db *database.DB) *ChargingHeatmapHandler {
	return &ChargingHeatmapHandler{db: db}
}

type heatmapCell struct {
	DayOfWeek    int     `json:"day_of_week"`
	HourOfDay    int     `json:"hour_of_day"`
	SessionCount int     `json:"session_count"`
	AvgEnergyWh  float64 `json:"avg_energy_wh"`
	AvgCost      float64 `json:"avg_cost"`
}

type locationBreakdown struct {
	Location  string  `json:"location"`
	Count     int     `json:"count"`
	TotalWh   float64 `json:"total_wh"`
	TotalCost float64 `json:"total_cost"`
	AvgPowerW float64 `json:"avg_power_w"`
}

type chargingSummary struct {
	TotalSessions int     `json:"total_sessions"`
	TotalWh       float64 `json:"total_wh"`
	TotalCost     float64 `json:"total_cost"`
	AvgDurationS  float64 `json:"avg_duration_s"`
}

func (h *ChargingHeatmapHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	// Phase-42 (000184_charging_si): SI canonical columns. We convert
	// total_energy_added_wh and peak_power_w are already SI canonical; the
	// frontend display boundary formats them with user preferences.
	// Heatmap data: hour of day × day of week
	heatmapRows, err := h.db.Pool.Query(ctx, `
		SELECT EXTRACT(DOW FROM started_at)::int  AS day_of_week,
		       EXTRACT(HOUR FROM started_at)::int AS hour_of_day,
		       COUNT(*)                            AS session_count,
		       COALESCE(AVG(total_energy_added_wh), 0) AS avg_energy_wh,
		       COALESCE(AVG(cost_decimal), 0)      AS avg_cost
		FROM charging_sessions
		WHERE vehicle_id = $1
		GROUP BY day_of_week, hour_of_day
		ORDER BY day_of_week, hour_of_day`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("charging heatmap: failed to query heatmap data")
		writeError(w, http.StatusInternalServerError, "failed to query heatmap data")
		return
	}
	defer heatmapRows.Close()

	var heatmap []heatmapCell
	for heatmapRows.Next() {
		var c heatmapCell
		if err := heatmapRows.Scan(&c.DayOfWeek, &c.HourOfDay, &c.SessionCount, &c.AvgEnergyWh, &c.AvgCost); err != nil {
			log.Error().Err(err).Msg("charging heatmap: scan heatmap row")
			writeError(w, http.StatusInternalServerError, "failed to scan heatmap data")
			return
		}
		c.AvgEnergyWh = math.Round(c.AvgEnergyWh*100) / 100
		c.AvgCost = math.Round(c.AvgCost*100) / 100
		heatmap = append(heatmap, c)
	}
	if err := heatmapRows.Err(); err != nil {
		log.Error().Err(err).Msg("charging heatmap: rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read heatmap data")
		return
	}

	// Location breakdown — Phase-42 replaces the legacy charger-location text
	// column with the geocoded start_place column captured at session start.
	locRows, err := h.db.Pool.Query(ctx, `
		SELECT COALESCE(start_place, 'Unknown')                  AS location,
		       COUNT(*)                                          AS count,
		       COALESCE(SUM(total_energy_added_wh), 0)           AS total_wh,
		       COALESCE(SUM(cost_decimal), 0)                    AS total_cost,
		       COALESCE(AVG(peak_power_w), 0)                    AS avg_power_w
		FROM charging_sessions
		WHERE vehicle_id = $1
		GROUP BY start_place
		ORDER BY count DESC
		LIMIT 10`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("charging heatmap: failed to query locations")
		writeError(w, http.StatusInternalServerError, "failed to query location data")
		return
	}
	defer locRows.Close()

	var locations []locationBreakdown
	for locRows.Next() {
		var l locationBreakdown
		if err := locRows.Scan(&l.Location, &l.Count, &l.TotalWh, &l.TotalCost, &l.AvgPowerW); err != nil {
			log.Error().Err(err).Msg("charging heatmap: scan location row")
			writeError(w, http.StatusInternalServerError, "failed to scan location data")
			return
		}
		l.TotalWh = math.Round(l.TotalWh*100) / 100
		l.TotalCost = math.Round(l.TotalCost*100) / 100
		l.AvgPowerW = math.Round(l.AvgPowerW*100) / 100
		locations = append(locations, l)
	}
	if err := locRows.Err(); err != nil {
		log.Error().Err(err).Msg("charging heatmap: location rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read location data")
		return
	}

	// Summary stats — duration derived from ended_at - started_at since the
	// legacy duration column was dropped by 000184.
	var summary chargingSummary
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*)                                                                      AS total_sessions,
		       COALESCE(SUM(total_energy_added_wh), 0)                                       AS total_wh,
		       COALESCE(SUM(cost_decimal), 0)                                                AS total_cost,
		       COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)                 AS avg_duration_s
		FROM charging_sessions WHERE vehicle_id = $1`, vehicleID).
		Scan(&summary.TotalSessions, &summary.TotalWh, &summary.TotalCost, &summary.AvgDurationS)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("charging heatmap: failed to query summary")
		writeError(w, http.StatusInternalServerError, "failed to query summary")
		return
	}
	summary.TotalWh = math.Round(summary.TotalWh*100) / 100
	summary.TotalCost = math.Round(summary.TotalCost*100) / 100
	summary.AvgDurationS = math.Round(summary.AvgDurationS*10) / 10

	if heatmap == nil {
		heatmap = []heatmapCell{}
	}
	if locations == nil {
		locations = []locationBreakdown{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"heatmap":   heatmap,
		"locations": locations,
		"summary":   summary,
	})
}
