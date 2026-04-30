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
// Field names match the frontend ChargingTelemetry interface in api/types.ts.
var chargingTelemetryMappings = []database.PivotMapping{
	{Signal: "ChargerVoltage", Field: "charger_voltage"},
	{Signal: "ChargerActualCurrent", Field: "charger_actual_current"},
	{Signal: "ChargeRateMilePerHour", Field: "charge_rate_mph"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "Soc", Field: "soc"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ACChargingEnergyIn", Field: "charge_energy_added_kwh"},
	{Signal: "DCChargingEnergyIn", Field: "energy_added_dc"},
	{Signal: "TimeToFullCharge", Field: "time_to_full_charge"},
	{Signal: "BrickVoltageMax", Field: "brick_voltage_max"},
	{Signal: "BrickVoltageMin", Field: "brick_voltage_min"},
	{Signal: "ACChargingPower", Field: "charger_power_kw"},
	{Signal: "ChargerPhases", Field: "charger_phases"},
	{Signal: "IdealBatteryRange", Field: "battery_range_mi"},
	{Signal: "ChargeState", Field: "charging_state"},
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
	// Merge DC power: for DC fast-charging, DCChargingPower is the active value.
	// Override charger_power_kw (from ACChargingPower) when DC power is positive.
	if dcVal, ok := snap["DCChargingPower"]; ok {
		if dc, dcOk := toFloatOk(dcVal); dcOk && dc > 0 {
			result["charger_power_kw"] = dcVal
		}
	}
	writeJSON(w, http.StatusOK, result)
}
