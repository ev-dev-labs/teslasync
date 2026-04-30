package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ClimateHandler serves climate/HVAC endpoints backed by signal_log.
type ClimateHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for climate pivot queries.
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (e.g. inside_temp → insideTemp).
var climateMappings = []database.PivotMapping{
	// Temperatures
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "HvacLeftTemperatureRequest", Field: "driver_temp_setting"},
	{Signal: "HvacRightTemperatureRequest", Field: "passenger_temp_setting"},
	// HVAC system
	{Signal: "HvacPower", Field: "hvac_power"},
	{Signal: "HvacACEnabled", Field: "is_ac_on"},
	{Signal: "HvacAutoMode", Field: "hvac_auto_mode"},
	{Signal: "HvacFanSpeed", Field: "fan_speed"},
	{Signal: "HvacFanStatus", Field: "hvac_fan_status"},
	// Climate modes
	{Signal: "ClimateKeeperMode", Field: "climate_keeper_mode"},
	{Signal: "DefrostMode", Field: "defrost_mode"},
	{Signal: "DefrostForPreconditioning", Field: "defrost_for_preconditioning"},
	{Signal: "RearDefrostEnabled", Field: "rear_defrost_enabled"},
	{Signal: "WiperHeatEnabled", Field: "wiper_heat_enabled"},
	{Signal: "RearDisplayHvacEnabled", Field: "rear_display_hvac_enabled"},
	// Battery & protection
	{Signal: "BatteryHeaterOn", Field: "battery_heater"},
	{Signal: "CabinOverheatProtectionMode", Field: "overheat_protection"},
	{Signal: "CabinOverheatProtectionTemperatureLimit", Field: "cabin_overheat_protection_temp_limit"},
	// Steering wheel
	{Signal: "HvacSteeringWheelHeatAuto", Field: "hvac_steering_wheel_heat_auto"},
	{Signal: "HvacSteeringWheelHeatLevel", Field: "hvac_steering_wheel_heat_level"},
	// Seat heaters
	{Signal: "SeatHeaterLeft", Field: "seat_heater_left"},
	{Signal: "SeatHeaterRight", Field: "seat_heater_right"},
	{Signal: "SeatHeaterRearLeft", Field: "seat_heater_rear_left"},
	{Signal: "SeatHeaterRearCenter", Field: "seat_heater_rear_center"},
	{Signal: "SeatHeaterRearRight", Field: "seat_heater_rear_right"},
	// Seat climate
	{Signal: "AutoSeatClimateLeft", Field: "auto_seat_climate_left"},
	{Signal: "AutoSeatClimateRight", Field: "auto_seat_climate_right"},
	{Signal: "ClimateSeatCoolingFrontLeft", Field: "climate_seat_cooling_front_left"},
	{Signal: "ClimateSeatCoolingFrontRight", Field: "climate_seat_cooling_front_right"},
	{Signal: "SeatVentEnabled", Field: "seat_vent_enabled"},
}

func NewClimateHandler(slr *database.SignalLogReader) *ClimateHandler {
	return &ClimateHandler{signalLogReader: slr}
}

// List returns climate history from signal_log via SignalTracePivotFlat.
func (h *ClimateHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, climateMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get climate data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get climate data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			row["timestamp"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent climate values via SnapshotAt(now).
func (h *ClimateHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest climate data")
		writeError(w, http.StatusInternalServerError, "failed to get latest climate data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range climateMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
