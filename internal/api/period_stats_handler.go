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

	// Build date filter (drives uses started_at, charging uses started_at).
	dateFilter := ""
	if days > 0 {
		dateFilter = " AND started_at > NOW() - interval '" + strconv.Itoa(days) + " days'"
	}

	// Total distance & drives. Phase-42 SI canonical drives (000172):
	// distance_m / duration_s. Convert to km/min at JSON-populate site.
	var totalDistM, totalDurS *float64
	var totalDrives int
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance_m), 0), COALESCE(SUM(duration_s), 0)
		 FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL`+dateFilter, vehicleID,
	).Scan(&totalDrives, &totalDistM, &totalDurS)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: drives query")
		writeError(w, http.StatusInternalServerError, "failed to query period stats")
		return
	}

	// Energy & cost from charging sessions. Phase-42 SI canonical
	// charging_sessions (000171): total_energy_added_wh, cost_decimal.
	var energyAddedWh, totalCost *float64
	chargeDateFilter := dateFilter
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(total_energy_added_wh), 0), COALESCE(SUM(cost_decimal::float8), 0)
		 FROM charging_sessions WHERE vehicle_id = $1`+chargeDateFilter, vehicleID,
	).Scan(&energyAddedWh, &totalCost)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: charging query")
		energyAddedWh = new(float64)
		totalCost = new(float64)
	}

	distM := 0.0
	if totalDistM != nil {
		distM = *totalDistM
	}
	energyWh := 0.0
	if energyAddedWh != nil {
		energyWh = *energyAddedWh
	}
	cost := 0.0
	if totalCost != nil {
		cost = *totalCost
	}

	// Convert SI → display units (km, kWh) at the response boundary.
	distKm := distM / 1000.0
	energyKWh := energyWh / 1000.0

	// Efficiency: Wh/km from SI columns directly (energy_wh / distance_km).
	avgEff := 0.0
	if distKm > 0 && energyWh > 0 {
		avgEff = energyWh / distKm
	}

	// CO2 saved vs ICE: ~120g/km for ICE, ~0 for EV (grid emissions vary)
	co2Saved := distKm * 0.120 // 120g/km saved → kg

	sf := func(v float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return math.Round(v*100) / 100
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_distance": sf(distKm),
		"total_drives":   totalDrives,
		"energy_used":    sf(energyKWh),
		"avg_efficiency": sf(avgEff),
		"total_cost":     sf(cost),
		"co2_saved":      sf(co2Saved),
	})
}
