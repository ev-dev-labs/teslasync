package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// BatteryHandler handles battery health HTTP requests.
type BatteryHandler struct {
	batteryRepo *database.BatterySnapshotRepo
}

func NewBatteryHandler(db *database.DB) *BatteryHandler {
	return &BatteryHandler{batteryRepo: database.NewBatterySnapshotRepo(db)}
}

func (h *BatteryHandler) Report(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	days := 3650
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 3650 {
			days = parsed
		}
	}

	snapshots, err := h.batteryRepo.GetByVehicle(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get battery snapshots")
		writeError(w, http.StatusInternalServerError, "failed to get battery report")
		return
	}

	if snapshots == nil {
		snapshots = make([]*models.BatterySnapshot, 0)
	}

	// Build response with latest data
	var healthScore, capacityKWh, degradation, estRange, avgTemp float64
	var cycleCount int
	if len(snapshots) > 0 {
		latest := snapshots[0]
		healthScore = latest.HealthScore
		capacityKWh = latest.CapacityKWh
		degradation = latest.DegradationPct
		estRange = latest.EstRangeKm
		cycleCount = latest.CycleCount
		avgTemp = latest.AvgCellTempC
	}

	// Build monthly trend from snapshots
	type trendPoint struct {
		Month       string  `json:"month"`
		HealthScore float64 `json:"health_score"`
		CapacityKWh float64 `json:"capacity_kwh"`
		EstRangeKm  float64 `json:"est_range_km"`
	}
	var trend []trendPoint
	for _, s := range snapshots {
		trend = append(trend, trendPoint{
			Month:       s.CreatedAt.Format("2006-01"),
			HealthScore: s.HealthScore,
			CapacityKWh: s.CapacityKWh,
			EstRangeKm:  s.EstRangeKm,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":      vehicleID,
		"health_score":    healthScore,
		"capacity_kwh":    capacityKWh,
		"degradation_pct": degradation,
		"est_range_km":    estRange,
		"cycle_count":     cycleCount,
		"avg_cell_temp_c": avgTemp,
		"monthly_trend":   trend,
	})
}
