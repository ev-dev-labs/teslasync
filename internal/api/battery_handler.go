package api

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// BatteryHandler handles battery health HTTP requests.
type BatteryHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewBatteryHandler(db *database.DB, slr *database.SignalLogReader) *BatteryHandler {
	return &BatteryHandler{db: db, signalLogReader: slr}
}

func (h *BatteryHandler) Report(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	// Derive battery health from signal_log (no more battery_snapshots table)
	var healthScore, capacityKWh, degradation, estRange, avgTemp float64
	var cycleCount int

	{
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
		_ = h.db.Pool.QueryRow(r.Context(),
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
	// TODO: derive monthly battery trend from signal_log BatteryLevel aggregates

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
