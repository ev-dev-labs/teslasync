package drivedyn

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"

	"github.com/rs/zerolog/log"
)

// DriveDynamicsHandler serves G-force and pedal surfaces from signal state.
// Latest reads must use LiveStateReader, not SELECT-LIMIT-1 from sparse typed telemetry rows, because per-field MQTT payloads can leave sibling columns empty even when live state has fresh values.
// It replaces the removed /signals/observations path for the Driving Dynamics panels.
type DriveDynamicsHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// driveDynamicsMappings projects Tesla signal names into the snake_case JSON fields consumed by GForcePanel and PedalUsage.
// Acceleration values are already in g despite the typed-table `_mps2` naming drift; do not multiply by 9.81 without auditing the UI.
var driveDynamicsMappings = []signal.FieldMapping{
	{Signal: "LateralAcceleration", Field: "lateral_acceleration"},
	{Signal: "LongitudinalAcceleration", Field: "longitudinal_acceleration"},
	{Signal: "PedalPosition", Field: "pedal_position"},
	{Signal: "BrakePedalPos", Field: "brake_pedal_position"},
	{Signal: "BrakePedal", Field: "brake_pedal_active"},
}

func NewDriveDynamicsHandler(state signal.StateReader, live signal.LiveStateReader) *DriveDynamicsHandler {
	return &DriveDynamicsHandler{state: state, live: live}
}

// List returns driving-dynamics history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each
// emission becomes one row; forward-folding ensures sparse signals
// (e.g. BrakePedal only re-emits on transition) carry their most
// recent value across rows that did not re-emit.
//
// Mirrors the contract pinned by tire_pressure_handler.List and the
// other per-subsystem List endpoints — identical date-range parsing,
// identical row-shaping (legacy created_at / id aliases), identical
// 500-on-StateReader-error semantics.
func (h *DriveDynamicsHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, driveDynamicsMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get drive-dynamics history from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive-dynamics history")
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

// Latest returns the most recent driving-dynamics values, derived from
// LiveStateReader.LiveState (live L1 cache, hydrated from L2 / Redis,
// with a signal_log fallback for keys absent from the live layer).
// Every driveDynamicsMappings entry whose Signal is present in the
// returned State is projected under its mapped Field name; signals
// the live layer has never observed are simply omitted from the
// response (frontend treats `undefined` as "—" / inactive).
//
// The endpoint NEVER returns a 200 with a silently-empty body if the
// upstream LiveStateReader fails — that would mask the well-known
// "no telemetry received yet" empty-state which is the expected
// rendering for vehicles whose signals legitimately have not flowed
// yet. Errors surface as HTTP 500.
func (h *DriveDynamicsHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest drive-dynamics state")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest drive-dynamics state")
		return
	}

	result := make(map[string]interface{})
	for _, m := range driveDynamicsMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// timelineRowsToFlat converts the canonical signal.StateReader timeline
// shape into the flat map[string]interface{} JSON-row shape the drive-dynamics
// endpoints emit.
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
