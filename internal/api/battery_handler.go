package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

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
	var healthScore, capacityKWh, degradation, estRange float64
	var avgTemp *float64
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
			// Derive avgTemp from ModuleTempMax/ModuleTempMin — nil means "no data"
			if valMax, err := h.signalLogReader.SignalAt(r.Context(), vehicleID, "ModuleTempMax", now); err == nil && valMax != nil {
				if tempMax, ok := toFloatOk(valMax); ok {
					if valMin, errMin := h.signalLogReader.SignalAt(r.Context(), vehicleID, "ModuleTempMin", now); errMin == nil && valMin != nil {
						if tempMin, okMin := toFloatOk(valMin); okMin {
							avg := (tempMax + tempMin) / 2
							avgTemp = &avg
						}
					}
				}
			}
		}

		// Count charge cycles from charging sessions (sum of SOC deltas / 100)
		var totalSOCDelta *float64
		if err := h.db.Pool.QueryRow(r.Context(),
			`SELECT SUM(GREATEST(end_battery_pct - start_battery_pct, 0)) 
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_pct > start_battery_pct`,
			vehicleID).Scan(&totalSOCDelta); err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("battery: charge cycle SOC delta query failed")
		}
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

	// Query cagg_battery_daily for battery trend
	trendDays := 90
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, parseErr := strconv.Atoi(d); parseErr == nil && parsed > 0 && parsed <= 3650 {
			trendDays = parsed
		}
	}
	trendCutoff := time.Now().UTC().AddDate(0, 0, -trendDays)
	const trendNominalCap = 75.0
	const trendNominalRange = 531.0

	trendRows, trendErr := h.db.Pool.Query(r.Context(),
		`SELECT bucket, end_soc, min_soc, max_soc
		 FROM cagg_battery_daily
		 WHERE vehicle_id = $1 AND bucket >= $2
		 ORDER BY bucket ASC`,
		vehicleID, trendCutoff)
	if trendErr == nil {
		defer trendRows.Close()
		for trendRows.Next() {
			var bucket time.Time
			var endSOC, minSOC, maxSOC *float64
			if scanErr := trendRows.Scan(&bucket, &endSOC, &minSOC, &maxSOC); scanErr != nil {
				log.Warn().Err(scanErr).Int64("vehicleID", vehicleID).Msg("battery: trend row scan failed")
				continue
			}
			soc := 0.0
			if endSOC != nil {
				soc = *endSOC
			}
			trend = append(trend, trendPoint{
				Month:       bucket.Format("2006-01-02"),
				CapacityPct: soc,
				HealthScore: soc,
				CapacityKWh: soc * trendNominalCap / 100,
				RangeKm:     soc * trendNominalRange / 100,
				EstRangeKm:  soc * trendNominalRange / 100,
			})
		}
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
