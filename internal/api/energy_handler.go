package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// EnergyHandler handles energy statistics HTTP requests.
type EnergyHandler struct {
	energyRepo *database.EnergyStatsRepo
}

func NewEnergyHandler(db *database.DB) *EnergyHandler {
	return &EnergyHandler{energyRepo: database.NewEnergyStatsRepo(db)}
}

func (h *EnergyHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	days := 30
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			days = int(time.Since(t).Hours()/24) + 1
			if days < 1 {
				days = 1
			}
		}
	} else if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 3650 {
			days = parsed
		}
	}

	breakdown, err := h.energyRepo.GetDailyBreakdown(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get energy breakdown")
		writeError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}

	totalEnergy, totalCost, totalDistance, err := h.energyRepo.GetTotalEnergy(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get total energy")
		writeError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}

	if breakdown == nil {
		breakdown = make([]*models.EnergyStatsRow, 0)
	}

	var avgEfficiency float64
	if totalDistance > 0 {
		avgEfficiency = totalEnergy / totalDistance * 1000 // Wh/km
	}

	co2Saved := totalEnergy * 0.4 // ~400g CO2 saved per kWh vs gasoline

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":               vehicleID,
		"period_days":              days,
		"total_energy_used_kwh":    totalEnergy,
		"total_energy_charged_kwh": totalEnergy,
		"total_kwh":                totalEnergy,
		"total_cost":               totalCost,
		"total_distance_km":        totalDistance,
		"avg_efficiency_wh_km":     avgEfficiency,
		"co2_saved_kg":             co2Saved,
		"daily_breakdown":          breakdown,
	})
}
