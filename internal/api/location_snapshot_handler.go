package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// LocationSnapshotHandler serves location endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (raw pivot +
// snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// A parked Tesla emits Latitude / Longitude / Elevation / GpsHeading
// once at park and then NEVER re-emits those fields until the vehicle
// moves again — Fleet Telemetry only emits a value when both the
// interval has elapsed AND the value has changed. Under the legacy raw
// pivot, a /location/latest call against a vehicle that has been parked
// for more than the lookback window would project NULL for lat / lon /
// heading / elevation, even though those values are perfectly known and
// stable. With StateReader.State forward-folding the change feed, the
// most recent emission of every signal is carried forward to the
// requested timestamp, so a parked vehicle always reports its real
// last-known position. This is critical: the location snapshot is the
// data source for the dashboard map pin, geofence checks, and the
// "where is my car?" view; a NULL lat / lon there would render the
// car as missing from the map.
type LocationSnapshotHandler struct {
	state signal.StateReader
}

// Signal → JSON field mappings for the location timeline + state
// projection. Field names match the existing location response shape
// (snake_case; the frontend camelCaseKeys transform produces matching
// camelCase keys on the wire).
var locationMappings = []signal.FieldMapping{
	// Position & GPS
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "GpsState", Field: "gps_state"},
	{Signal: "Elevation", Field: "elevation_m"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
	// Navigation & route
	{Signal: "DestinationName", Field: "destination_name"},
	{Signal: "MilesToArrival", Field: "miles_to_arrival"},
	{Signal: "MinutesToArrival", Field: "minutes_to_arrival"},
	{Signal: "RouteTrafficMinutesDelay", Field: "route_traffic_delay_min"},
	{Signal: "RouteLastUpdated", Field: "route_last_updated"},
	// Destination / origin coordinates. The Tesla Location compound
	// (lat,lng pair) is unpacked into these scalar signal names by the
	// StateReader implementation (Prompt 05), so the handler can
	// project them as ordinary scalar fields.
	{Signal: "DestinationLatitude", Field: "destination_lat"},
	{Signal: "DestinationLongitude", Field: "destination_lon"},
	{Signal: "OriginLatitude", Field: "origin_lat"},
	{Signal: "OriginLongitude", Field: "origin_lon"},
	// Presence
	{Signal: "LocatedAtHome", Field: "located_at_home"},
	{Signal: "LocatedAtWork", Field: "located_at_work"},
	{Signal: "LocatedAtFavorite", Field: "located_at_favorite"},
	{Signal: "HomelinkNearby", Field: "homelink_nearby"},
}

func NewLocationSnapshotHandler(state signal.StateReader) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{state: state}
}

// List returns location history from the signal-log change feed via
// StateReader.Timeline in CHART MODE (empty CollapseBy). Each
// change-feed emission becomes one row; forward-folding ensures the
// rarely-emitted GPS / route signals carry their most-recent values
// across rows where they did not re-emit, so the location-history
// panel is never blank simply because the vehicle has been stationary.
func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, locationMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get location data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get location data")
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

// Latest returns the most recent location values, derived from the
// forward-folded signal-log state at time.Now() via StateReader.State.
// Because State forward-folds the change feed, a parked vehicle that
// has not emitted Latitude / Longitude in hours still reports its
// real last-known coordinates — the absence of a recent emission must
// NEVER be misread as "no location" (which would blank the map pin).
// Every locationMappings entry whose Signal is present in State is
// projected under its mapped Field name; absent signals are omitted.
func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.state.State(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest location data")
		writeError(w, http.StatusInternalServerError, "failed to get latest location data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range locationMappings {
		if v, ok := snap[m.Signal]; ok && v != nil {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
