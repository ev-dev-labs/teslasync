package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChargingTelemetryHandler serves charging telemetry endpoints backed by signal_log.
type ChargingTelemetryHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for charging telemetry pivot queries.
var chargingTelemetryMappings = []database.PivotMapping{
	{Signal: "ChargerVoltage", Field: "charger_voltage"},
	{Signal: "ChargerActualCurrent", Field: "charger_current"},
	{Signal: "ChargeRateMilePerHour", Field: "charge_rate"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "Soc", Field: "soc"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ACChargingEnergyIn", Field: "energy_added_ac"},
	{Signal: "DCChargingEnergyIn", Field: "energy_added_dc"},
	{Signal: "TimeToFullCharge", Field: "time_to_full_charge"},
	{Signal: "BrickVoltageMax", Field: "brick_voltage_max"},
	{Signal: "BrickVoltageMin", Field: "brick_voltage_min"},
}

func NewChargingTelemetryHandler(slr *database.SignalLogReader) *ChargingTelemetryHandler {
	return &ChargingTelemetryHandler{signalLogReader: slr}
}

// List returns charging telemetry history from signal_log via SignalTracePivotFlat.
func (h *ChargingTelemetryHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	if start, end := parseDateRange(r); !start.IsZero() {
		from = start
		if !end.IsZero() {
			to = end
		}
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		vehicleID, chargingTelemetryMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get charging telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get charging telemetry data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent charging telemetry values via SnapshotAt(now).
func (h *ChargingTelemetryHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest charging telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get latest charging telemetry")
		return
	}

	result := make(map[string]interface{})
	for _, m := range chargingTelemetryMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
