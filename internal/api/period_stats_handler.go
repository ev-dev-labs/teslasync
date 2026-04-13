package api

import (
	"math"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// PeriodStatsHandler serves period comparison analytics.
type PeriodStatsHandler struct {
	db *database.DB
}

func NewPeriodStatsHandler(db *database.DB) *PeriodStatsHandler {
	return &PeriodStatsHandler{db: db}
}

func (h *PeriodStatsHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	daysStr := r.URL.Query().Get("days")
	days, _ := strconv.Atoi(daysStr)

	ctx := r.Context()

	// Build date filter
	dateFilter := ""
	if days > 0 {
		dateFilter = " AND start_date > NOW() - interval '" + strconv.Itoa(days) + " days'"
	}

	// Total distance & drives
	var totalDist, totalDurMin *float64
	var totalDrives int
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance), 0), COALESCE(SUM(duration_min), 0)
		 FROM drives WHERE vehicle_id = $1 AND end_date IS NOT NULL`+dateFilter, vehicleID,
	).Scan(&totalDrives, &totalDist, &totalDurMin)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: drives query")
		writeError(w, http.StatusInternalServerError, "failed to query period stats")
		return
	}

	// Energy & cost from charging sessions
	var energyUsed, totalCost *float64
	chargeDateFilter := dateFilter
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(charge_energy_added), 0), COALESCE(SUM(cost), 0)
		 FROM charging_sessions WHERE vehicle_id = $1`+chargeDateFilter, vehicleID,
	).Scan(&energyUsed, &totalCost)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: charging query")
		energyUsed = new(float64)
		totalCost = new(float64)
	}

	dist := 0.0
	if totalDist != nil {
		dist = *totalDist
	}
	energy := 0.0
	if energyUsed != nil {
		energy = *energyUsed
	}
	cost := 0.0
	if totalCost != nil {
		cost = *totalCost
	}

	// Efficiency: Wh/km
	avgEff := 0.0
	if dist > 0 && energy > 0 {
		avgEff = (energy * 1000) / dist // kWh → Wh / km
	}

	// CO2 saved vs ICE: ~120g/km for ICE, ~0 for EV (grid emissions vary)
	co2Saved := dist * 0.120 // 120g/km saved → kg

	sf := func(v float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return math.Round(v*100) / 100
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_distance": sf(dist),
		"total_drives":   totalDrives,
		"energy_used":    sf(energy),
		"avg_efficiency": sf(avgEff),
		"total_cost":     sf(cost),
		"co2_saved":      sf(co2Saved),
	})
}
