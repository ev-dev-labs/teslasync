package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// VehicleConfigHandler serves vehicle config endpoints backed by the
// signal-log change feed via signal.StateReader (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (raw pivot +
// snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// VehicleConfig is a COMPOUND signal — its payload is a JSON object with
// car_type, trim_badging, exterior_color, wheel_type, and (optionally)
// firmware-version metadata. It is emitted by Tesla Fleet Telemetry only
// when the configuration actually changes — practically never. A car that
// is delivered as a Model Y Long Range with 19" Geminis in Pearl White
// emits VehicleConfig once at delivery and then never again unless the
// owner repaints, retrofits new wheels, or applies a software-tier
// upgrade. The signal can sit unchanged for the entire vehicle lifetime.
//
// Under the legacy raw pivot, a /vehicle-config/latest call against any
// vehicle whose VehicleConfig had not re-emitted within the lookback
// window would return an EMPTY object — even though the configuration
// is perfectly known and stable. With StateReader.State forward-folding
// the change feed, the most recent emission is carried forward to the
// requested timestamp, so the latest endpoint always returns the
// vehicle's actual current configuration.
//
// This is critical: model / trim / wheel / color drive every spec lookup
// in the dashboard (battery capacity, EPA range, motor topology, tire
// size). An empty config here would cause every per-model calculation
// downstream to fall back to defaults or display "Unknown".
type VehicleConfigHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for the vehicle-config timeline + state
// projection. VehicleConfig is a COMPOUND JSONB signal: its payload is
// a JSON object that the handler flattens to top-level keys in the
// response. The intermediate "config" projection key never reaches the
// wire.
var vehicleConfigMappings = []signal.FieldMapping{
	{Signal: "VehicleConfig", Field: "config"},
}

func NewVehicleConfigHandler(state signal.StateReader, live signal.LiveStateReader) *VehicleConfigHandler {
	return &VehicleConfigHandler{state: state, live: live}
}

// List returns vehicle config history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each
// change-feed emission becomes one row; forward-folding ensures the
// rarely-emitted VehicleConfig signal carries its most-recent JSON
// payload across rows where it did not re-emit, so the config-history
// panel is never blank simply because the vehicle has not been
// reconfigured during the lookback window.
//
// The compound JSON payload is flattened to top-level keys per row so
// the existing frontend (which reads car_type / trim_badging /
// exterior_color / wheel_type directly) keeps working unchanged. The
// intermediate "config" projection key never appears in the response.
func (h *VehicleConfigHandler) List(w http.ResponseWriter, r *http.Request) {
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
		vehicleID, vehicleConfigMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get vehicle config data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle config data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
		// VehicleConfig is a compound JSONB signal — flatten to top level
		// so the wire shape matches the legacy pivoted response.
		if configVal, ok := row["config"]; ok {
			if configMap, ok := configVal.(map[string]interface{}); ok {
				for k, v := range configMap {
					row[k] = v
				}
				delete(row, "config")
			}
		}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent vehicle configuration, derived from
// the forward-folded signal-log state at time.Now() via
// StateReader.State. Because State forward-folds the change feed, a
// vehicle whose VehicleConfig last emitted at delivery (months or
// years ago) still reports its real, current configuration — the
// absence of a recent emission must NEVER be misread as "no config
// known", because every downstream per-model calculation (battery
// capacity, EPA range, tire size) keys off these fields.
//
// The compound JSON payload is flattened to top-level keys in the
// response so the existing frontend keeps working unchanged. If
// VehicleConfig is somehow present but NOT a JSON object, the raw
// value is projected under the "config" key as a defensive fallback.
func (h *VehicleConfigHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest vehicle config")
		writeError(w, http.StatusInternalServerError, "failed to get latest vehicle config")
		return
	}

	result := make(map[string]interface{})
	for _, m := range vehicleConfigMappings {
		if v, ok := snap[m.Signal]; ok {
			// VehicleConfig is a compound JSONB signal — flatten to top level.
			if configMap, ok := v.(map[string]interface{}); ok {
				for k, val := range configMap {
					result[k] = val
				}
			} else {
				result[m.Field] = v
			}
		}
	}
	writeJSON(w, http.StatusOK, result)
}
