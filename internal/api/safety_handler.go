package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SafetyHandler serves safety snapshot endpoints backed by signal_log.
type SafetyHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for safety pivot queries (ADAS signals).
var safetyMappings = []database.PivotMapping{
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

func NewSafetyHandler(slr *database.SignalLogReader) *SafetyHandler {
	return &SafetyHandler{signalLogReader: slr}
}

// List returns safety history from signal_log via SignalTracePivotFlat.
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

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		vehicleID, safetyMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get safety data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get safety data")
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

// Latest returns the most recent safety values via SnapshotAt(now).
func (h *SafetyHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
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
