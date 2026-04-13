package api

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// BatteryCellsHandler serves battery cell analytics derived from charging telemetry.
type BatteryCellsHandler struct {
	chargingTelemetryRepo *database.ChargingTelemetryRepo
}

func NewBatteryCellsHandler(db *database.DB) *BatteryCellsHandler {
	return &BatteryCellsHandler{
		chargingTelemetryRepo: database.NewChargingTelemetryRepo(db),
	}
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
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid or missing vehicle_id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Fetch recent telemetry for history (last 100 records)
	records, err := h.chargingTelemetryRepo.GetByVehicle(ctx, vehicleID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query charging telemetry")
		return
	}

	if len(records) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total_cells":   0,
			"avg_voltage":   0,
			"min_voltage":   0,
			"max_voltage":   0,
			"imbalance_mv":  0,
			"pack_voltage":  0,
			"cells":         []cellReading{},
			"history":       []historyPoint{},
		})
		return
	}

	// Use the latest record with brick voltage data for current state
	latest := findLatestWithBrickData(records)
	cells, summary := buildCellData(latest)

	// Build history from records that have brick voltage data
	history := buildHistory(records)

	// Build response with fields matching both analytics and frontend BatteryCellSummary types
	// Get temperature data from the latest record
	avgTemp, minTemp, maxTemp := extractTemps(latest)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_cells":      summary.totalCells,
		"avg_voltage":      round4(summary.avgVoltage),
		"min_voltage":      round4(summary.minVoltage),
		"max_voltage":      round4(summary.maxVoltage),
		"voltage_spread":   round4(summary.maxVoltage - summary.minVoltage),
		"imbalance_mv":     round2(summary.imbalanceMV),
		"pack_voltage":     round2(summary.packVoltage),
		"avg_temperature":  round2(avgTemp),
		"min_temperature":  round2(minTemp),
		"max_temperature":  round2(maxTemp),
		"temp_spread":      round2(maxTemp - minTemp),
		"cells":            buildFrontendCells(cells, summary.totalCells),
		"history":          history,
	})
}

// GetByVehicle handles GET /vehicles/{vehicleID}/battery/cells — reads vehicleID from path.
func (h *BatteryCellsHandler) GetByVehicle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("vehicle_id", urlParamVehicleID(r))
	r.URL.RawQuery = q.Encode()
	h.Get(w, r)
}

type cellSummary struct {
	totalCells  int
	avgVoltage  float64
	minVoltage  float64
	maxVoltage  float64
	imbalanceMV float64
	packVoltage float64
}

// findLatestWithBrickData returns the most recent record that has brick voltage data.
func findLatestWithBrickData(records []*models.ChargingTelemetry) *models.ChargingTelemetry {
	for _, r := range records {
		if r.BrickVoltageMax != nil && r.BrickVoltageMin != nil {
			return r
		}
	}
	if len(records) > 0 {
		return records[0]
	}
	return nil
}

// buildCellData synthesizes individual cell readings from brick voltage aggregates.
// Tesla reports min/max brick voltages and which brick numbers hold those values.
// We interpolate a realistic spread across a typical module count (4 modules, ~23 bricks each
// for Model Y 4680 or ~96 groups for 2170 packs).
func buildCellData(latest *models.ChargingTelemetry) ([]cellReading, cellSummary) {
	if latest == nil {
		return []cellReading{}, cellSummary{}
	}

	vMax := derefF64(latest.BrickVoltageMax)
	vMin := derefF64(latest.BrickVoltageMin)
	packV := derefF64(latest.PackVoltage)

	if vMax == 0 && vMin == 0 {
		return []cellReading{}, cellSummary{packVoltage: packV}
	}

	// Estimate cell count from pack voltage and avg cell voltage
	avgV := (vMax + vMin) / 2
	totalCells := 96 // default for typical Tesla pack
	if avgV > 0 && packV > 0 {
		estimated := int(math.Round(packV / avgV))
		if estimated >= 72 && estimated <= 110 {
			totalCells = estimated
		}
	}

	spread := vMax - vMin
	imbalanceMV := spread * 1000

	// Generate synthetic cell voltages distributed between min and max
	cells := make([]cellReading, totalCells)
	minBrick := derefInt(latest.NumBrickVoltageMin)
	maxBrick := derefInt(latest.NumBrickVoltageMax)

	for i := 0; i < totalCells; i++ {
		var voltage float64
		if i == minBrick {
			voltage = vMin
		} else if i == maxBrick {
			voltage = vMax
		} else {
			// Distribute most cells near avg with slight gaussian-like spread
			t := float64(i) / float64(totalCells-1)
			voltage = vMin + t*spread
			// Add slight clustering toward average
			voltage = avgV + (voltage-avgV)*0.6
		}
		delta := voltage - avgV
		status := "normal"
		absDelta := math.Abs(delta) * 1000
		if absDelta > 20 {
			status = "critical"
		} else if absDelta > 10 {
			if delta < 0 {
				status = "low"
			} else {
				status = "high"
			}
		}
		cells[i] = cellReading{
			CellNumber:   i + 1,
			Voltage:      round4(voltage),
			DeltaFromAvg: round4(delta),
			Status:       status,
		}
	}

	sort.Slice(cells, func(i, j int) bool {
		return cells[i].CellNumber < cells[j].CellNumber
	})

	return cells, cellSummary{
		totalCells:  totalCells,
		avgVoltage:  avgV,
		minVoltage:  vMin,
		maxVoltage:  vMax,
		imbalanceMV: imbalanceMV,
		packVoltage: packV,
	}
}

// buildHistory creates history points from telemetry records with brick voltage data.
func buildHistory(records []*models.ChargingTelemetry) []historyPoint {
	var points []historyPoint
	for _, r := range records {
		if r.BrickVoltageMax == nil || r.BrickVoltageMin == nil {
			continue
		}
		vMax := *r.BrickVoltageMax
		vMin := *r.BrickVoltageMin
		avg := (vMax + vMin) / 2
		points = append(points, historyPoint{
			Timestamp:   r.CreatedAt.Format(time.RFC3339),
			MinVoltage:  round4(vMin),
			MaxVoltage:  round4(vMax),
			AvgVoltage:  round4(avg),
			ImbalanceMV: round2((vMax - vMin) * 1000),
		})
	}
	// Reverse so oldest is first (records come DESC)
	for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
		points[i], points[j] = points[j], points[i]
	}
	return points
}

func derefF64(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}

// extractTemps returns avg/min/max temperature from charging telemetry.
func extractTemps(ct *models.ChargingTelemetry) (avg, min, max float64) {
	if ct == nil {
		return 0, 0, 0
	}
	tMax := derefF64(ct.ModuleTempMax)
	tMin := derefF64(ct.ModuleTempMin)
	if tMax == 0 && tMin == 0 {
		return 0, 0, 0
	}
	return (tMax + tMin) / 2, tMin, tMax
}

// frontendCell matches the BatteryCell TypeScript interface.
type frontendCell struct {
	CellID      int     `json:"cell_id"`
	Module      int     `json:"module"`
	Voltage     float64 `json:"voltage"`
	Temperature float64 `json:"temperature"`
}

// buildFrontendCells converts internal cellReadings to the shape the frontend expects.
func buildFrontendCells(cells []cellReading, totalCells int) []frontendCell {
	moduleCells := 24 // typical cells per module
	if totalCells > 0 {
		moduleCells = totalCells / 4
		if moduleCells < 1 {
			moduleCells = 1
		}
	}
	out := make([]frontendCell, len(cells))
	for i, c := range cells {
		out[i] = frontendCell{
			CellID:      c.CellNumber,
			Module:      (c.CellNumber-1)/moduleCells + 1,
			Voltage:     c.Voltage,
			Temperature: 25.0, // nominal; real per-cell temps not available from Tesla
		}
	}
	return out
}
