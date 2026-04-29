package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// BatteryCellsHandler serves battery cell analytics derived from signal store
// (real-time) and signal_log hypertable (historical).
type BatteryCellsHandler struct {
	db              *database.DB
	liveSignals     signal.LiveSignalStore
	signalLogReader *database.SignalLogReader
}

func NewBatteryCellsHandler(db *database.DB, liveStore signal.LiveSignalStore, slr *database.SignalLogReader) *BatteryCellsHandler {
	return &BatteryCellsHandler{db: db, liveSignals: liveStore, signalLogReader: slr}
}

type cellReading struct {
	CellNumber   int     `json:"cell_number"`
	Voltage      float64 `json:"voltage"`
	DeltaFromAvg float64 `json:"delta_from_avg"`
	Status       string  `json:"status"`
}

type historyPoint struct {
	Timestamp   string  `json:"timestamp"`
	MinVoltage  float64 `json:"min_voltage"`
	MaxVoltage  float64 `json:"max_voltage"`
	AvgVoltage  float64 `json:"avg_voltage"`
	ImbalanceMV float64 `json:"imbalance_mv"`
}

// Get handles GET /analytics/battery-cells?vehicle_id=X
func (h *BatteryCellsHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	// Read latest signal values (signal store → signal_log fallback)
	brickMax, hasBrickMax := h.getLatestSignal(ctx, vehicleID, "BrickVoltageMax")
	brickMin, hasBrickMin := h.getLatestSignal(ctx, vehicleID, "BrickVoltageMin")
	numMax, hasNumMax := h.getLatestSignal(ctx, vehicleID, "NumBrickVoltageMax")
	numMin, hasNumMin := h.getLatestSignal(ctx, vehicleID, "NumBrickVoltageMin")
	packVoltage, _ := h.getLatestSignal(ctx, vehicleID, "PackVoltage")
	tempMax, _ := h.getLatestSignal(ctx, vehicleID, "ModuleTempMax")
	tempMin, _ := h.getLatestSignal(ctx, vehicleID, "ModuleTempMin")

	// No brick voltage data — return empty response with status indicator
	if !hasBrickMax && !hasBrickMin {
		log.Debug().Int64("vehicle_id", vehicleID).Msg("battery cells: no brick voltage data")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":          "no_data",
			"total_cells":     0,
			"avg_voltage":     0,
			"min_voltage":     0,
			"max_voltage":     0,
			"voltage_spread":  0,
			"imbalance_mv":    0,
			"pack_voltage":    round2(packVoltage),
			"avg_temperature": round2((tempMax + tempMin) / 2),
			"min_temperature": round2(tempMin),
			"max_temperature": round2(tempMax),
			"temp_spread":     round2(tempMax - tempMin),
			"cells":           []cellReading{},
			"history":         []historyPoint{},
		})
		return
	}

	// Compute derived values
	voltageSpread := (brickMax - brickMin) * 1000 // V → mV
	avgVoltage := (brickMax + brickMin) / 2
	avgTemp := (tempMax + tempMin) / 2
	tempSpread := tempMax - tempMin

	// Estimate total cells from pack voltage / avg cell voltage
	totalCells := 0
	if avgVoltage > 0 {
		totalCells = int(math.Round(packVoltage / avgVoltage))
	}
	if totalCells == 0 {
		totalCells = 96 // Model S/X default
	}

	// Generate synthetic cell readings from aggregate min/max data.
	// Tesla Fleet Telemetry sends aggregate brick voltages, not per-cell.
	cells := make([]cellReading, totalCells)
	for i := 0; i < totalCells; i++ {
		var t float64
		if totalCells > 1 {
			t = float64(i) / float64(totalCells-1)
		}
		voltage := brickMin + t*(brickMax-brickMin)
		delta := (voltage - avgVoltage) * 1000 // mV

		status := "normal"
		if math.Abs(delta) > 15 {
			status = "significant_deviation"
		} else if math.Abs(delta) > 5 {
			status = "slight_deviation"
		}

		cells[i] = cellReading{
			CellNumber:   i + 1,
			Voltage:      round4(voltage),
			DeltaFromAvg: round2(delta),
			Status:       status,
		}
	}

	// Place actual min/max values on their known brick indices
	if hasNumMax && int(numMax) >= 0 && int(numMax) < totalCells {
		cells[int(numMax)].Voltage = round4(brickMax)
		cells[int(numMax)].DeltaFromAvg = round2((brickMax - avgVoltage) * 1000)
	}
	if hasNumMin && int(numMin) >= 0 && int(numMin) < totalCells {
		cells[int(numMin)].Voltage = round4(brickMin)
		cells[int(numMin)].DeltaFromAvg = round2((brickMin - avgVoltage) * 1000)
	}

	// Query historical brick voltage data from signal_log
	history := h.getHistory(ctx, vehicleID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_cells":     totalCells,
		"avg_voltage":     round4(avgVoltage),
		"min_voltage":     round4(brickMin),
		"max_voltage":     round4(brickMax),
		"voltage_spread":  round2(voltageSpread),
		"imbalance_mv":    round2(voltageSpread),
		"pack_voltage":    round2(packVoltage),
		"avg_temperature": round2(avgTemp),
		"min_temperature": round2(tempMin),
		"max_temperature": round2(tempMax),
		"temp_spread":     round2(tempSpread),
		"cells":           cells,
		"history":         history,
		"min_cell":        fmt.Sprintf("#%d", int(numMin)+1),
		"max_cell":        fmt.Sprintf("#%d", int(numMax)+1),
	})
}

// GetByVehicle handles GET /vehicles/{vehicleID}/battery/cells — reads vehicleID from path.
func (h *BatteryCellsHandler) GetByVehicle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("vehicle_id", urlParamVehicleID(r))
	r.URL.RawQuery = q.Encode()
	h.Get(w, r)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}

// getLatestSignal reads a fresh live signal first, falling back to signal_log.
func (h *BatteryCellsHandler) getLatestSignal(ctx context.Context, vehicleID int64, signalName string) (float64, bool) {
	if h.liveSignals != nil {
		value, err := h.liveSignals.GetSignal(ctx, vehicleID, signalName, signal.LiveSignalReadDistributed)
		if err == nil && value != nil {
			if v, ok := toFloatOk(value.Raw); ok {
				return v, true
			}
		} else if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("signal", signalName).Msg("battery cells: live signal read failed")
		}
	}
	if h.signalLogReader != nil {
		val, err := h.signalLogReader.SignalAt(ctx, vehicleID, signalName, time.Now())
		if err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				return v, true
			}
		}
	}
	return 0, false
}

// getHistory queries signal_log for hourly brick voltage buckets over the past 7 days.
func (h *BatteryCellsHandler) getHistory(ctx context.Context, vehicleID int64) []historyPoint {
	if h.signalLogReader == nil {
		return []historyPoint{}
	}

	since := time.Now().Add(-7 * 24 * time.Hour)
	entries, err := h.signalLogReader.BrickVoltageHistory(ctx, vehicleID, since)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("battery cells: history query failed")
		return []historyPoint{}
	}

	points := make([]historyPoint, 0, len(entries))
	for _, e := range entries {
		var minV, maxV, avgMax, avgMin float64
		if e.MinVoltage != nil {
			minV = *e.MinVoltage
		}
		if e.MaxVoltage != nil {
			maxV = *e.MaxVoltage
		}
		if e.AvgMax != nil {
			avgMax = *e.AvgMax
		}
		if e.AvgMin != nil {
			avgMin = *e.AvgMin
		}
		avgVoltage := (avgMax + avgMin) / 2
		imbalance := (maxV - minV) * 1000 // V → mV

		points = append(points, historyPoint{
			Timestamp:   e.Bucket.Format(time.RFC3339),
			MinVoltage:  round4(minV),
			MaxVoltage:  round4(maxV),
			AvgVoltage:  round4(avgVoltage),
			ImbalanceMV: round2(imbalance),
		})
	}
	return points
}

// frontendCell matches the BatteryCell TypeScript interface.
type frontendCell struct {
	CellID      int     `json:"cell_id"`
	Module      int     `json:"module"`
	Voltage     float64 `json:"voltage"`
	Temperature float64 `json:"temperature"`
}
