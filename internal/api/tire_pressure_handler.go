package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// TirePressureHandler serves TPMS endpoints backed by the signal-log change
// feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot +
// snapshot helpers) has been replaced with the canonical signal.StateReader.
//
// Tire pressure (TpmsPressureFl/Fr/Rl/Rr) and the matching
// last-seen-pressure-time signals re-emit VERY rarely — typically once per
// week, sometimes longer for a parked vehicle. Under the legacy raw-pivot
// implementation, every chart row whose bucket did not contain a fresh
// TpmsPressureFl emission rendered front_left as NULL, producing the
// well-known "blank tire pressure dial" bug across long stable runs and
// rendering the TPMS history chart effectively unusable for vehicles that
// had not been driven recently. With StateReader.Timeline forward-folding
// (chart mode — empty CollapseBy so every emission becomes one row), every
// row carries the most recently observed value of every projected signal,
// fixing the carry-forward bug end-to-end.
type TirePressureHandler struct {
	state signal.StateReader
}

// Signal → JSON field mappings for TPMS timeline / state projection.
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (e.g. front_left → frontLeft).
var tirePressureMappings = []signal.FieldMapping{
	{Signal: "TpmsPressureFl", Field: "front_left"},
	{Signal: "TpmsPressureFr", Field: "front_right"},
	{Signal: "TpmsPressureRl", Field: "rear_left"},
	{Signal: "TpmsPressureRr", Field: "rear_right"},
	{Signal: "TpmsLastSeenPressureTimeFl", Field: "last_seen_fl"},
	{Signal: "TpmsLastSeenPressureTimeFr", Field: "last_seen_fr"},
	{Signal: "TpmsLastSeenPressureTimeRl", Field: "last_seen_rl"},
	{Signal: "TpmsLastSeenPressureTimeRr", Field: "last_seen_rr"},
}

func NewTirePressureHandler(state signal.StateReader) *TirePressureHandler {
	return &TirePressureHandler{state: state}
}

// List returns TPMS history from the signal-log change feed via
// StateReader.Timeline in CHART MODE (empty CollapseBy). Each emission
// becomes one row; forward-folding ensures the rarely-emitted TPMS
// pressures and last-seen-pressure-times carry their most-recent values
// across rows where they did not re-emit, fixing the legacy "blank tire
// pressure dial" bug for long stable runs.
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

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, tirePressureMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get tire pressure from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get tire pressure data")
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

// Latest returns the most recent TPMS values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
// Every tirePressureMappings entry whose Signal is present in State is
// projected under its mapped Field name.
func (h *TirePressureHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.state.State(r.Context(), vehicleID, time.Now())
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
