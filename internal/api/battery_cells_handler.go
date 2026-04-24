package api

import (
	"math"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// BatteryCellsHandler serves battery cell analytics derived from charging telemetry.
// NOTE: The post-migration ChargingTelemetry model no longer carries brick voltage
// signals (BrickVoltageMax/Min, PackVoltage, etc.). These were previously in
// JSONB signals columns. Until a signal-based data source is wired, this handler
// returns empty/default cell analytics.
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
	// Brick voltage signals are no longer on the typed ChargingTelemetry model.
	// Return empty analytics until signal-based data source is wired.
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_cells":     0,
		"avg_voltage":     0,
		"min_voltage":     0,
		"max_voltage":     0,
		"voltage_spread":  0,
		"imbalance_mv":    0,
		"pack_voltage":    0,
		"avg_temperature": 0,
		"min_temperature": 0,
		"max_temperature": 0,
		"temp_spread":     0,
		"cells":           []cellReading{},
		"history":         []historyPoint{},
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

// frontendCell matches the BatteryCell TypeScript interface.
type frontendCell struct {
	CellID      int     `json:"cell_id"`
	Module      int     `json:"module"`
	Voltage     float64 `json:"voltage"`
	Temperature float64 `json:"temperature"`
}
