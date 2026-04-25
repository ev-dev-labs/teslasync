package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SecurityHandler serves security/access endpoints backed by signal_log.
type SecurityHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for security pivot queries.
var securityMappings = []database.PivotMapping{
	{Signal: "Locked", Field: "locked"},
	{Signal: "SentryMode", Field: "sentry_mode"},
	{Signal: "DoorState", Field: "doors"},
	{Signal: "WindowState", Field: "windows"},
}

func NewSecurityHandler(slr *database.SignalLogReader) *SecurityHandler {
	return &SecurityHandler{signalLogReader: slr}
}

// List returns security history from signal_log via SignalTracePivotFlat.
func (h *SecurityHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, securityMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get security data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get security data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent security values via SnapshotAt(now).
func (h *SecurityHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest security data")
		writeError(w, http.StatusInternalServerError, "failed to get latest security data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range securityMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
