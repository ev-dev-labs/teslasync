package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TirePressureHandler serves TPMS endpoints backed by signal_log.
type TirePressureHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for TPMS pivot queries.
var tirePressureMappings = []database.PivotMapping{
	{Signal: "TpmsPressureFl", Field: "front_left"},
	{Signal: "TpmsPressureFr", Field: "front_right"},
	{Signal: "TpmsPressureRl", Field: "rear_left"},
	{Signal: "TpmsPressureRr", Field: "rear_right"},
	{Signal: "TpmsLastSeenPressureTimeFl", Field: "last_seen_fl"},
	{Signal: "TpmsLastSeenPressureTimeFr", Field: "last_seen_fr"},
	{Signal: "TpmsLastSeenPressureTimeRl", Field: "last_seen_rl"},
	{Signal: "TpmsLastSeenPressureTimeRr", Field: "last_seen_rr"},
}

func NewTirePressureHandler(slr *database.SignalLogReader) *TirePressureHandler {
	return &TirePressureHandler{signalLogReader: slr}
}

// List returns TPMS history from signal_log via SignalTracePivotFlat.
func (h *TirePressureHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, tirePressureMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get tire pressure from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get tire pressure data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent TPMS values via SnapshotAt(now).
func (h *TirePressureHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest tire pressure")
		writeError(w, http.StatusInternalServerError, "failed to get latest tire pressure")
		return
	}

	result := make(map[string]interface{})
	for _, m := range tirePressureMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
