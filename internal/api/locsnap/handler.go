package locsnap

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// LocationSnapshotHandler serves location endpoints via the canonical
// StateReader/live-state stack (ADR-002). Forward-folding is required
// because parked vehicles may not re-emit stable coordinates for hours, yet the
// dashboard map and geofence checks still need the last-known position.
type LocationSnapshotHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for the location timeline + state
// projection. Field names match the existing location response shape
// (snake_case; the frontend camelCaseKeys transform produces matching
// camelCase keys on the wire).
var locationMappings = []signal.FieldMapping{
	// Position & GPS — codec compound-flatten names. Elevation
	// is intentionally absent (Tesla Fleet Telemetry does not emit it).
	{Signal: "LocationLatitude", Field: "latitude"},
	{Signal: "LocationLongitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "GpsState", Field: "gps_state"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
	// Navigation & route
	{Signal: "DestinationName", Field: "destination_name"},
	{Signal: "MilesToArrival", Field: "miles_to_arrival"},
	{Signal: "MinutesToArrival", Field: "minutes_to_arrival"},
	{Signal: "RouteTrafficMinutesDelay", Field: "route_traffic_delay_s"},
	{Signal: "RouteLastUpdated", Field: "route_last_updated"},
	// Destination / origin coordinates. The Tesla Location compound
	// (lat,lng pair) is unpacked into these scalar signal names by the
	// StateReader implementation, so the handler can
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

func NewLocationSnapshotHandler(state signal.StateReader, live signal.LiveStateReader) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{state: state, live: live}
}

// List returns chart-mode location history. Empty CollapseBy preserves every
// emission, while forward-folding keeps stable GPS and route fields populated.
func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, locationMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get location data from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get location data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		convertRouteTrafficDelayToSeconds(row)
		row["id"] = i + 1
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// Latest returns forward-folded live location values. A missing recent GPS
// emission must not blank the map pin when the last-known coordinates are stable.
func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest location data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest location data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range locationMappings {
		if v, ok := snap[m.Signal]; ok && v != nil {
			result[m.Field] = v
		}
	}
	convertRouteTrafficDelayToSeconds(result)
	httpx.WriteJSON(w, http.StatusOK, result)
}

// timelineRowsToFlat converts the canonical signal.StateReader timeline shape
// into the flat map[string]interface{} JSON-row shape the location snapshot
// endpoints emit. Duplicated from internal/api/drive_handler_detail.go until
// that handler is also carved into a subpackage.
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

func convertRouteTrafficDelayToSeconds(row map[string]interface{}) {
	v, ok := row["route_traffic_delay_s"]
	if !ok {
		return
	}
	if minutes, ok := signal.Float64(v); ok {
		row["route_traffic_delay_s"] = minutes * 60
	}
}
