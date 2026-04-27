package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// LocationSnapshotHandler serves location endpoints backed by signal_log.
type LocationSnapshotHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for location pivot queries.
var locationMappings = []database.PivotMapping{
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "GpsState", Field: "gps_state"},
	{Signal: "Elevation", Field: "elevation_m"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
}

func NewLocationSnapshotHandler(slr *database.SignalLogReader) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{signalLogReader: slr}
}

// List returns location history from signal_log via SignalTracePivotFlat.
func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, locationMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get location data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get location data")
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

// Latest returns the most recent location values via SnapshotAt(now).
func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest location data")
		writeError(w, http.StatusInternalServerError, "failed to get latest location data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range locationMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
