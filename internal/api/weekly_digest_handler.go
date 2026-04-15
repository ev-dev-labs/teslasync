package api

import (
	"context"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// WeeklyDigestHandler returns aggregated stats comparing current vs previous week.
type WeeklyDigestHandler struct {
	db *database.DB
}

func NewWeeklyDigestHandler(db *database.DB) *WeeklyDigestHandler {
	return &WeeklyDigestHandler{db: db}
}

func (h *WeeklyDigestHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	now := time.Now()
	weekStart := now.AddDate(0, 0, -int(now.Weekday()))
	weekStart = time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, now.Location())
	prevWeekStart := weekStart.AddDate(0, 0, -7)

	type weekStats struct {
		Drives     int     `json:"drives"`
		DistanceKm float64 `json:"distance_km"`
		EnergyKwh  float64 `json:"energy_kwh"`
		Cost       float64 `json:"cost"`
		Efficiency float64 `json:"efficiency"`
	}

	query := func(start, end time.Time) weekStats {
		var s weekStats
		_ = h.db.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*),
				COALESCE(SUM(distance), 0),
				COALESCE(SUM(CASE WHEN distance > 0 THEN
					(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)) * 0.150
				ELSE 0 END), 0),
				COALESCE(SUM(CASE WHEN distance > 0 THEN
					(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)) * 0.150 * 0.14
				ELSE 0 END), 0)
			FROM drives
			WHERE vehicle_id = $1 AND start_date >= $2 AND start_date < $3`,
			vehicleID, start, end).Scan(&s.Drives, &s.DistanceKm, &s.EnergyKwh, &s.Cost)

		if s.DistanceKm > 0 {
			s.Efficiency = s.EnergyKwh / s.DistanceKm * 1000 // Wh/km
		}
		return s
	}

	curr := query(weekStart, now)
	prev := query(prevWeekStart, weekStart)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"drives":          curr.Drives,
		"distance_km":     curr.DistanceKm,
		"energy_kwh":      curr.EnergyKwh,
		"cost":            curr.Cost,
		"efficiency":      curr.Efficiency,
		"prev_drives":     prev.Drives,
		"prev_distance_km": prev.DistanceKm,
		"prev_energy_kwh": prev.EnergyKwh,
		"prev_cost":       prev.Cost,
		"prev_efficiency": prev.Efficiency,
	})
}
