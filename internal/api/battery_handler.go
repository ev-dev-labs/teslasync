package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// BatteryHandler handles battery health HTTP requests.
type BatteryHandler struct {
	batteryRepo     *database.BatterySnapshotRepo
	signalLogReader *database.SignalLogReader
}

func NewBatteryHandler(db *database.DB, slr *database.SignalLogReader) *BatteryHandler {
	return &BatteryHandler{batteryRepo: database.NewBatterySnapshotRepo(db), signalLogReader: slr}
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

	// If no battery snapshots, derive basic health metrics from signal_log
	if healthScore == 0 {
		const nominalCapacity = 75.0
		const nominalRangeKm = 531.0

		if h.signalLogReader != nil {
			now := time.Now()
			if val, err := h.signalLogReader.SignalAt(r.Context(), vehicleID, "EnergyRemaining", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					capacityKWh = v
					healthScore = (capacityKWh / nominalCapacity) * 100
					if healthScore > 100 {
						healthScore = 100
					}
					degradation = 100 - healthScore
				}
			}
			if val, err := h.signalLogReader.SignalAt(r.Context(), vehicleID, "EstBatteryRange", now); err == nil && val != nil {
				if v, ok := toFloatOk(val); ok && v > 0 {
					estRange = v
				}
			}
		}

		// Count charge cycles from charging sessions (sum of SOC deltas / 100)
		var totalSOCDelta *float64
		_ = h.batteryRepo.DB().Pool.QueryRow(r.Context(),
			`SELECT SUM(GREATEST(end_battery_pct - start_battery_pct, 0)) 
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_pct > start_battery_pct`,
			vehicleID).Scan(&totalSOCDelta)
		if totalSOCDelta != nil {
			cycleCount = int(*totalSOCDelta / 100)
		}
	}

	// Build monthly trend from snapshots
	type trendPoint struct {
		Month       string  `json:"month"`
		CapacityPct float64 `json:"capacity_pct"`
		RangeKm     float64 `json:"range_km"`
		HealthScore float64 `json:"health_score"`
		CapacityKWh float64 `json:"capacity_kwh"`
		EstRangeKm  float64 `json:"est_range_km"`
	}
	var trend []trendPoint
	for _, s := range snapshots {
		trend = append(trend, trendPoint{
			Month:       s.CreatedAt.Format("2006-01"),
			CapacityPct: s.HealthScore,
			RangeKm:     s.EstRangeKm,
			HealthScore: s.HealthScore,
			CapacityKWh: s.CapacityKWh,
			EstRangeKm:  s.EstRangeKm,
		})
	}

	// Model Y Long Range nominal range ~531 km (330 mi)
	const nominalRangeKm = 531.0

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":                  vehicleID,
		"health_score":                healthScore,
		"capacity_kwh":                capacityKWh,
		"current_capacity_pct":        healthScore,
		"degradation_pct":             degradation,
		"est_range_km":                estRange,
		"estimated_range_current_km":  estRange,
		"estimated_range_new_km":      nominalRangeKm,
		"total_cycles":                cycleCount,
		"cycle_count":                 cycleCount,
		"avg_cell_temp_c":             avgTemp,
		"monthly_trend":               trend,
	})
}
