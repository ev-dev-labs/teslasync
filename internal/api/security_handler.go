package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// SecurityHandler serves security / access endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot
// + snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// Lock state, sentry mode, valet mode, service mode, guest mode and the
// per-door / per-window position flags are user-controlled or
// vehicle-state signals that change RARELY relative to the chart bucket
// cadence — a parked, locked car may emit Locked once at park and never
// again until the driver returns. Under the legacy raw-pivot
// implementation, every history row whose bucket did not contain a fresh
// emission for one of these signals rendered that column as NULL,
// leaving the security history table almost entirely blank for any
// vehicle that had stable lock / sentry / mode settings. With
// StateReader.Timeline forward-folding (chart mode — empty CollapseBy so
// every change-feed emission becomes one row), every row carries the
// most-recently-observed value of every projected signal, fixing the
// carry-forward gap end-to-end. This is critically important for the
// security domain because the absence of a recent emission MUST NOT be
// misread as "unlocked" / "sentry off" / "doors open" — those would all
// be alarming false negatives in a security history view.
type SecurityHandler struct {
	state signal.StateReader
}

// Signal → JSON field mappings for security timeline + state projection.
// Field names match the existing security response shape (snake_case;
// the frontend camelCaseKeys transform produces matching camelCase keys
// on the wire).
var securityMappings = []signal.FieldMapping{
	{Signal: "Locked", Field: "locked"},
	{Signal: "SentryMode", Field: "sentry_mode"},
	{Signal: "DoorState", Field: "door_state"},
	{Signal: "FdWindow", Field: "fd_window"},
	{Signal: "FpWindow", Field: "fp_window"},
	{Signal: "RdWindow", Field: "rd_window"},
	{Signal: "RpWindow", Field: "rp_window"},
	{Signal: "HomelinkNearby", Field: "homelink_nearby"},
	{Signal: "GuestModeEnabled", Field: "guest_mode"},
	{Signal: "HomelinkDeviceCount", Field: "homelink_device_count"},
	{Signal: "GuestModeMobileAccessState", Field: "guest_mode_mobile_access_state"},
	{Signal: "DriverSeatOccupied", Field: "driver_seat_occupied"},
	{Signal: "CenterDisplay", Field: "center_display"},
	{Signal: "SpeedLimitMode", Field: "speed_limit_mode"},
	{Signal: "ValetModeEnabled", Field: "valet_mode_enabled"},
	{Signal: "ServiceMode", Field: "service_mode"},
	{Signal: "PairedPhoneKeyAndKeyFobQty", Field: "paired_phone_key_count"},
	{Signal: "LightsHazardsActive", Field: "lights_hazards_active"},
	{Signal: "LightsHighBeams", Field: "lights_high_beams"},
	{Signal: "LightsTurnSignal", Field: "lights_turn_signal"},
	{Signal: "DriverSeatBelt", Field: "driver_seat_belt"},
	{Signal: "PassengerSeatBelt", Field: "passenger_seat_belt"},
}

func NewSecurityHandler(state signal.StateReader) *SecurityHandler {
	return &SecurityHandler{state: state}
}

// List returns security / access history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each
// emission becomes one row; forward-folding ensures the rarely-emitted
// lock / sentry / valet / service / guest / window / door signals carry
// their most-recent values across rows where they did not re-emit, so
// the security history table never blanks a column simply because the
// vehicle has not changed state recently.
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

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, securityMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get security data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get security data")
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

// Latest returns the most recent security / access values, derived from
// the forward-folded signal-log state at time.Now() via
// StateReader.State. Every securityMappings entry whose Signal is
// present in State is projected under its mapped Field name; absent
// signals are omitted.
func (h *SecurityHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.state.State(r.Context(), vehicleID, time.Now())
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
