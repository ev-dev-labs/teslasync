package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/service"
)

// EnergyHandler handles energy statistics HTTP requests.
type EnergyHandler struct {
	energySvc *service.EnergyService
}

func NewEnergyHandler(energySvc *service.EnergyService) *EnergyHandler {
	return &EnergyHandler{energySvc: energySvc}
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

	stats, err := h.energySvc.CalculateStats(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get energy stats")
		writeError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":               stats.VehicleID,
		"period_days":              stats.PeriodDays,
		"total_energy_used_kwh":    stats.TotalEnergy,
		"total_energy_charged_kwh": stats.TotalEnergy,
		"total_kwh":                stats.TotalEnergy,
		"total_cost":               stats.TotalCost,
		"total_distance_km":        stats.TotalDistance,
		"avg_efficiency_wh_km":     stats.AvgEfficiency,
		"co2_saved_kg":             stats.CO2Saved,
		"daily_breakdown":          stats.DailyBreakdown,
	})
}

// AnalyticsStats handles GET /analytics/energy?vehicle_id=X&days=Y
func (h *EnergyHandler) AnalyticsStats(w http.ResponseWriter, r *http.Request) {
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

	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 3650 {
			days = parsed
		}
	}

	stats, err := h.energySvc.CalculateStats(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get energy stats")
		writeError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":               stats.VehicleID,
		"period_days":              stats.PeriodDays,
		"total_energy_used_kwh":    stats.TotalEnergy,
		"total_energy_charged_kwh": stats.TotalEnergy,
		"total_kwh":                stats.TotalEnergy,
		"total_cost":               stats.TotalCost,
		"total_distance_km":        stats.TotalDistance,
		"avg_efficiency_wh_km":     stats.AvgEfficiency,
		"co2_saved_kg":             stats.CO2Saved,
		"daily_breakdown":          stats.DailyBreakdown,
	})
}
