package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// MotorHandler serves motor / drive-inverter / powertrain endpoints backed
// by the signal-log change feed via signal.StateReader (ADR-002 /
// phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot
// + snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// Drive-inverter signals (DiTorqueActualF/R, DiAxleSpeedF/R, DiStatorTempF/R,
// DiInverterTF/R, DiHeatsinkTF/R, DiVBatF/R, DiStateF/R, Gear, …) emit at
// very different cadences while the car is driving, parking, or charging.
// The drive-state signals (DiStateF/R, Gear) in particular re-emit only on
// transition — for a parked car they may not re-emit for hours. Under the
// legacy raw-pivot implementation, every chart row whose bucket did not
// contain a fresh DiStateF emission rendered state_front as NULL, leaving
// the powertrain chart with empty cells across long stable runs. With
// StateReader.Timeline forward-folding (chart mode — empty CollapseBy so
// every change-feed emission becomes one row), every row carries the
// most-recently-observed value of every projected signal, fixing the
// carry-forward gap end-to-end.
type MotorHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for motor / powertrain timeline + state
// projection. Field names match the frontend MotorSnapshot interface in
// web/src/api/types.ts (snake_case; the frontend camelCaseKeys transform
// produces matching camelCase keys on the wire).
var motorMappings = []signal.FieldMapping{
	{Signal: "DiMotorCurrentF", Field: "motor_current_front"},
	{Signal: "DiMotorCurrentR", Field: "motor_current_rear"},
	{Signal: "DiTorqueActualF", Field: "torque_nm_front"},
	{Signal: "DiTorqueActualR", Field: "torque_nm_rear"},
	{Signal: "DiTorquemotor", Field: "di_torque"},
	{Signal: "DiAxleSpeedF", Field: "motor_rpm_front"},
	{Signal: "DiAxleSpeedR", Field: "motor_rpm_rear"},
	{Signal: "DiStatorTempF", Field: "motor_temp_c_front"},
	{Signal: "DiStatorTempR", Field: "motor_temp_c_rear"},
	{Signal: "DiHeatsinkTF", Field: "heatsink_temp_front"},
	{Signal: "DiHeatsinkTR", Field: "heatsink_temp_rear"},
	{Signal: "DiInverterTF", Field: "inverter_temp_c"},
	{Signal: "DiInverterTR", Field: "inverter_temp_rear"},
	{Signal: "DiStateF", Field: "state_front"},
	{Signal: "DiStateR", Field: "state_rear"},
	{Signal: "DiVBatF", Field: "vbat_front"},
	{Signal: "DiVBatR", Field: "vbat_rear"},
	{Signal: "Gear", Field: "shift_state"},
}

func NewMotorHandler(state signal.StateReader, live signal.LiveStateReader) *MotorHandler {
	return &MotorHandler{state: state, live: live}
}

// List returns motor / powertrain history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each emission
// becomes one row; forward-folding ensures the rarely-emitted drive-state
// signals (DiStateF/R, Gear) and the slowly-changing inverter-temperature
// signals carry their most-recent values across rows where they did not
// re-emit.
func (h *MotorHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, motorMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get motor data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get motor data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent motor / powertrain values, derived from
// the forward-folded signal-log state at time.Now() via StateReader.State.
// Every motorMappings entry whose Signal is present in State is projected
// under its mapped Field name; absent signals are omitted.
func (h *MotorHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest motor data")
		writeError(w, http.StatusInternalServerError, "failed to get latest motor data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range motorMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
