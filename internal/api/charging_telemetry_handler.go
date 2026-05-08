package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ChargingTelemetryHandler serves charging telemetry endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot +
// snapshot helpers) has been replaced with the canonical signal.StateReader.
// The /charging-telemetry history endpoint feeds a stepped-line chart on the
// frontend, so List uses Timeline in CHART MODE (empty CollapseBy) — every
// change-feed emission becomes one row, preserving the legacy flat-pivot
// semantics. The /charging-telemetry/latest endpoint reads forward-folded
// state at time.Now() via StateReader.State.
type ChargingTelemetryHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for charging telemetry projection.
// Field names match the frontend ChargingTelemetry interface in api/types.ts.
var chargingTelemetryMappings = []signal.FieldMapping{
	{Signal: "ChargerVoltage", Field: "charger_voltage"},
	{Signal: "ChargerActualCurrent", Field: "charger_actual_current"},
	{Signal: "RangeAddedMetersPerHour", Field: "range_added_meters_per_hour"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "Soc", Field: "soc"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ACChargingEnergyIn", Field: "charge_energy_added_wh"},
	{Signal: "DCChargingEnergyIn", Field: "energy_added_dc"},
	{Signal: "TimeToFullCharge", Field: "time_to_full_charge"},
	{Signal: "BrickVoltageMax", Field: "brick_voltage_max"},
	{Signal: "BrickVoltageMin", Field: "brick_voltage_min"},
	{Signal: "ACChargingPower", Field: "charger_power_w"},
	{Signal: "ChargerPhases", Field: "charger_phases"},
	{Signal: "IdealBatteryRange", Field: "battery_range_mi"},
	{Signal: "ChargeState", Field: "charging_state"},
}

func NewChargingTelemetryHandler(state signal.StateReader, live signal.LiveStateReader) *ChargingTelemetryHandler {
	return &ChargingTelemetryHandler{state: state, live: live}
}

// List returns charging telemetry history from the signal-log change feed.
// Chart mode (empty CollapseBy) preserves every emission as one row so the
// frontend stepped-line chart renders correctly — collapsing would drop
// "still 200V, still 65%" tuples and break the time series rendering.
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

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, chargingTelemetryMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get charging telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get charging telemetry data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent charging telemetry values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
func (h *ChargingTelemetryHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
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
	// Override charger_power_w (from ACChargingPower) when DC power is positive.
	if dcVal, ok := snap["DCChargingPower"]; ok {
		if dc, dcOk := toFloatOk(dcVal); dcOk && dc > 0 {
			result["charger_power_w"] = dcVal
		}
	}
	writeJSON(w, http.StatusOK, result)
}
