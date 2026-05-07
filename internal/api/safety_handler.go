package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// SafetyHandler serves safety / ADAS snapshot endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot
// + snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// ADAS / Autopilot enable flags (AutomaticEmergencyBrakingOff,
// LaneDepartureAvoidance, ForwardCollisionWarning, PinToDriveEnabled, …)
// are user-configured driver-assist toggles that VERY rarely change —
// often once at vehicle delivery and never again, sometimes never. Under
// the legacy raw-pivot implementation, every chart row whose bucket did
// not contain a fresh emission for one of these flags rendered that
// column as NULL, leaving the safety history table almost entirely
// blank for any vehicle that had stable ADAS settings. With
// StateReader.Timeline forward-folding (chart mode — empty CollapseBy so
// every change-feed emission becomes one row), every row carries the
// most-recently-observed value of every projected signal, fixing the
// carry-forward gap end-to-end. This is critically important for the
// safety domain because the absence of a recent emission MUST NOT be
// misread as the feature being disabled.
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

// List returns safety / ADAS history from the signal-log change feed via
// StateReader.Timeline in CHART MODE (empty CollapseBy). Each emission
// becomes one row; forward-folding ensures the rarely-emitted ADAS enable
// flags carry their most-recent values across rows where they did not
// re-emit, so the safety history table never blanks a column simply
// because the user has not toggled that setting recently.
func (h *SafetyHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, safetyMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get safety data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get safety data")
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

// Latest returns the most recent safety / ADAS values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
// Every safetyMappings entry whose Signal is present in State is projected
// under its mapped Field name; absent signals are omitted.
func (h *SafetyHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest safety data")
		writeError(w, http.StatusInternalServerError, "failed to get latest safety data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range safetyMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
