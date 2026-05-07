package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ClimateHandler serves climate/HVAC endpoints backed by the signal-log
// change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot +
// snapshot helpers) has been replaced with the canonical signal.StateReader.
// Climate fields (cabin temp, HVAC state, seat heaters) change rarely once
// set — many emissions occur once per day. The legacy raw-pivot
// implementation rendered later rows as having NULL for every signal that
// did not re-emit inside the bucket, so the climate history chart on the
// frontend showed sawtooth gaps. With StateReader.Timeline forward-folding
// (chart mode — empty CollapseBy so every emission becomes one row), every
// row carries the most recently observed value of every projected signal,
// fixing the "blank cabin temp" rendering bug across long stable runs.
type ClimateHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for climate timeline / state projection.
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (e.g. inside_temp → insideTemp).
var climateMappings = []signal.FieldMapping{
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

func NewClimateHandler(state signal.StateReader, live signal.LiveStateReader) *ClimateHandler {
	return &ClimateHandler{state: state, live: live}
}

// List returns climate history from the signal-log change feed via
// StateReader.Timeline in CHART MODE (empty CollapseBy). Each emission
// becomes one row; forward-folding ensures rare HVAC fields (cabin temp,
// seat heaters, defrost mode) carry their most-recent value across rows
// where they did not re-emit, fixing the legacy "blank panel" bug for
// long stable climate runs.
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

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, climateMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get climate data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get climate data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			row["timestamp"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent climate values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
// Every climateMappings entry whose Signal is present in State is
// projected under its mapped Field name.
func (h *ClimateHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
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
