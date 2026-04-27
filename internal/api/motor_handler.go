package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MotorHandler serves motor/powertrain endpoints backed by signal_log.
type MotorHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for motor/powertrain pivot queries.
var motorMappings = []database.PivotMapping{
	{Signal: "DiMotorCurrentF", Field: "motor_current_front"},
	{Signal: "DiMotorCurrentR", Field: "motor_current_rear"},
	{Signal: "DiTorqueActualF", Field: "torque_front"},
	{Signal: "DiTorqueActualR", Field: "torque_rear"},
	{Signal: "DiTorquemotor", Field: "torque_motor"},
	{Signal: "DiAxleSpeedF", Field: "axle_speed_front"},
	{Signal: "DiAxleSpeedR", Field: "axle_speed_rear"},
	{Signal: "DiStatorTempF", Field: "stator_temp_front"},
	{Signal: "DiStatorTempR", Field: "stator_temp_rear"},
	{Signal: "DiHeatsinkTF", Field: "heatsink_temp_front"},
	{Signal: "DiHeatsinkTR", Field: "heatsink_temp_rear"},
	{Signal: "DiInverterTF", Field: "inverter_temp_front"},
	{Signal: "DiInverterTR", Field: "inverter_temp_rear"},
	{Signal: "DiStateF", Field: "state_front"},
	{Signal: "DiStateR", Field: "state_rear"},
	{Signal: "DiVBatF", Field: "vbat_front"},
	{Signal: "DiVBatR", Field: "vbat_rear"},
}

func NewMotorHandler(slr *database.SignalLogReader) *MotorHandler {
	return &MotorHandler{signalLogReader: slr}
}

// List returns motor/powertrain history from signal_log via SignalTracePivotFlat.
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

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		vehicleID, motorMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get motor data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get motor data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent motor/powertrain values via SnapshotAt(now).
func (h *MotorHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
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
