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
var climateMappings = []database.PivotMapping{
	{Signal: "InsideTemp", Field: "inside_temp_c"},
	{Signal: "OutsideTemp", Field: "outside_temp_c"},
	{Signal: "HvacPower", Field: "hvac_state"},
	{Signal: "DefrostMode", Field: "defrost_mode"},
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
