package tirepressure

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// TirePressureHandler serves TPMS endpoints backed by the signal-log change
// feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *signaldb.SignalLogReader (the old pivot +
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
	live  signal.LiveStateReader
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

func NewTirePressureHandler(state signal.StateReader, live signal.LiveStateReader) *TirePressureHandler {
	return &TirePressureHandler{state: state, live: live}
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
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	if start, end := apiparams.ParseDateRange(r); !start.IsZero() {
		from = start
		if !end.IsZero() {
			to = end
		}
	}

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, tirePressureMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get tire pressure from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get tire pressure data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent TPMS values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
// Every tirePressureMappings entry whose Signal is present in State is
// projected under its mapped Field name.
func (h *TirePressureHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest tire pressure")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest tire pressure")
		return
	}

	result := make(map[string]interface{})
	for _, m := range tirePressureMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// timelineRowsToFlat converts ordered TimelineRows into the legacy
// []map[string]interface{} flat-pivot shape ({"ts": ts, "<field>": value, ...})
// that the tire-pressure endpoint emits. Duplicated until the shared
// signal-history handlers finish their R2 carve.
func timelineRowsToFlat(rows []signal.TimelineRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, tr := range rows {
		row := make(map[string]interface{}, len(tr.Fields)+1)
		for k, v := range tr.Fields {
			row[k] = v
		}
		row["ts"] = tr.Timestamp
		out = append(out, row)
	}
	return out
}
