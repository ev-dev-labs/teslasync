package userpref

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// UserPreferenceHandler serves user preference endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *signaldb.SignalLogReader (raw pivot +
// snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// User preferences (units, 24-hour clock, charge/distance/temperature/
// tire-pressure unit selections) are USER-PINNED settings that emit
// once when the driver picks them in the UI and then NEVER re-emit
// until the driver changes them again — Fleet Telemetry only emits a
// value when both the interval has elapsed AND the value has changed.
// In practice these signals can sit unchanged for MONTHS or YEARS.
//
// Under the legacy raw pivot, a /user-preference/latest call against a
// vehicle whose owner has not touched their unit settings within the
// lookback window would project NULL for every unit field, even though
// the values are perfectly known and stable. With StateReader.State
// forward-folding the change feed, the most recent emission of every
// signal is carried forward to the requested timestamp, so the latest
// preferences endpoint always returns the user's actual current
// settings.
//
// This is critical: unit preferences drive every formatted value on
// the dashboard (km vs mi, °C vs °F, psi vs bar, 24h vs 12h clock).
// A NULL unit here would cause the frontend to fall back to defaults,
// silently flipping a metric-units owner's whole UI to imperial.
type UserPreferenceHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for the user-preference timeline + state
// projection. Field names match the existing user-preference response
// shape (snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys on the wire).
var userPrefMappings = []signal.FieldMapping{
	{Signal: "Setting24HourTime", Field: "setting_24hr_time"},
	{Signal: "SettingChargeUnit", Field: "setting_charge_unit"},
	{Signal: "SettingDistanceUnit", Field: "setting_distance_unit"},
	{Signal: "SettingTemperatureUnit", Field: "setting_temperature_unit"},
	{Signal: "SettingTirePressureUnit", Field: "setting_tire_pressure_unit"},
}

func NewUserPreferenceHandler(state signal.StateReader, live signal.LiveStateReader) *UserPreferenceHandler {
	return &UserPreferenceHandler{state: state, live: live}
}

// List returns user preference history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each
// change-feed emission becomes one row; forward-folding ensures the
// rarely-emitted unit-selection signals carry their most-recent values
// across rows where they did not re-emit, so the preference-history
// panel is never blank simply because the owner has not toggled a
// setting recently.
func (h *UserPreferenceHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, userPrefMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get user preference data from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get user preference data")
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

// Latest returns the most recent user preference values, derived from
// the forward-folded signal-log state at time.Now() via
// StateReader.State. Because State forward-folds the change feed, a
// vehicle whose owner has not changed any unit setting in months still
// reports its real, current unit selections — the absence of a recent
// emission must NEVER be misread as "no preferences" (which would
// silently flip the owner's UI to default units). Every userPrefMappings
// entry whose Signal is present in State is projected under its mapped
// Field name; absent signals are omitted.
func (h *UserPreferenceHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest user preference data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest user preference data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range userPrefMappings {
		if v, ok := snap[m.Signal]; ok && v != nil {
			result[m.Field] = v
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// timelineRowsToFlat converts ordered TimelineRows into the legacy
// []map[string]interface{} flat-pivot shape ({"ts": ts, "<field>": value, ...}).
// Duplicated locally until the parent drive detail helper is carved/shared.
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
