package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// UserPreferenceHandler serves user preference endpoints backed by signal_log.
type UserPreferenceHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for user preference pivot queries.
var userPrefMappings = []database.PivotMapping{
	{Signal: "Setting24HourTime", Field: "setting_24hr_time"},
	{Signal: "SettingChargeUnit", Field: "setting_charge_unit"},
	{Signal: "SettingDistanceUnit", Field: "setting_distance_unit"},
	{Signal: "SettingTemperatureUnit", Field: "setting_temperature_unit"},
	{Signal: "SettingTirePressureUnit", Field: "setting_tire_pressure_unit"},
}

func NewUserPreferenceHandler(slr *database.SignalLogReader) *UserPreferenceHandler {
	return &UserPreferenceHandler{signalLogReader: slr}
}

// List returns user preference history from signal_log via SignalTracePivotFlat.
func (h *UserPreferenceHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, userPrefMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get user preference data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get user preference data")
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

// Latest returns the most recent user preference values via SnapshotAt(now).
func (h *UserPreferenceHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest user preference data")
		writeError(w, http.StatusInternalServerError, "failed to get latest user preference data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range userPrefMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
