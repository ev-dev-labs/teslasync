package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// VehicleConfigHandler serves vehicle config endpoints backed by signal_log.
type VehicleConfigHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for vehicle config pivot queries.
// VehicleConfig is a compound signal stored in value_jsonb.
var vehicleConfigMappings = []database.PivotMapping{
	{Signal: "VehicleConfig", Field: "config"},
}

func NewVehicleConfigHandler(slr *database.SignalLogReader) *VehicleConfigHandler {
	return &VehicleConfigHandler{signalLogReader: slr}
}

// List returns vehicle config history from signal_log via SignalTracePivotFlat.
func (h *VehicleConfigHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, vehicleConfigMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get vehicle config data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle config data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent vehicle config via SnapshotAt(now).
func (h *VehicleConfigHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest vehicle config")
		writeError(w, http.StatusInternalServerError, "failed to get latest vehicle config")
		return
	}

	result := make(map[string]interface{})
	for _, m := range vehicleConfigMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
