package safety

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"

	"github.com/rs/zerolog/log"
)

// SafetyHandler serves safety / ADAS endpoints via the canonical StateReader
// stack (ADR-002). Forward-folding is required because stable ADAS
// toggles rarely re-emit, but absence of a recent emission must not mean disabled.
type SafetyHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for safety / ADAS timeline + state
// projection. Field names match the existing safety response shape
// (snake_case; the frontend camelCaseKeys transform produces matching
// camelCase keys on the wire).
var safetyMappings = []signal.FieldMapping{
	{Signal: "AutomaticEmergencyBrakingOff", Field: "automatic_emergency_braking_off"},
	{Signal: "AutomaticBlindSpotCamera", Field: "automatic_blind_spot_camera"},
	{Signal: "BlindSpotCollisionWarningChime", Field: "blind_spot_collision_warning"},
	{Signal: "CruiseFollowDistance", Field: "cruise_follow_distance"},
	{Signal: "EmergencyLaneDepartureAvoidance", Field: "emergency_lane_departure_avoidance"},
	{Signal: "ForwardCollisionWarning", Field: "forward_collision_warning"},
	{Signal: "LaneDepartureAvoidance", Field: "lane_departure_avoidance"},
	{Signal: "SpeedLimitWarning", Field: "speed_limit_warning"},
	{Signal: "PinToDriveEnabled", Field: "pin_to_drive_enabled"},
	{Signal: "MilesSinceReset", Field: "miles_since_reset"},
	{Signal: "SelfDrivingMilesSinceReset", Field: "self_driving_miles_since_reset"},
}

func NewSafetyHandler(state signal.StateReader, live signal.LiveStateReader) *SafetyHandler {
	return &SafetyHandler{state: state, live: live}
}

// List returns chart-mode safety history. Forward-folding keeps rarely emitted
// ADAS toggles populated across rows where the value did not re-emit.
func (h *SafetyHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, safetyMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get safety data from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get safety data")
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

// Latest returns forward-folded live safety / ADAS values projected to the
// existing response field names.
func (h *SafetyHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest safety data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest safety data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range safetyMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// timelineRowsToFlat converts signal timeline rows into the flat JSON row shape
// expected by existing safety history consumers.
func timelineRowsToFlat(rows []signal.TimelineRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		m := make(map[string]interface{}, len(row.Fields)+1)
		m["ts"] = row.Timestamp
		for key, value := range row.Fields {
			m[key] = value
		}
		out = append(out, m)
	}
	return out
}
