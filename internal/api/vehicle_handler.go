package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
)

// VehicleHandler handles vehicle-related HTTP requests.
// Business logic (state assembly, Tesla sync) is delegated to
// VehicleService; the handler focuses on HTTP concerns.
//
// state is the signal-log-backed cold-path reader (ADR-002 / phase-39)
// used by Positions to derive a chart-mode timeline of GPS samples by
// forward-folding the change feed; every emission becomes a row, even
// when the projected fields are unchanged from the previous emission.
type VehicleHandler struct {
	vehicleSvc       *service.VehicleService
	teslaClient      *tesla.Client
	telemetryHandler *TelemetryHandler
	state            signal.StateReader
}

// vehiclePositionMappings projects the signal_log change feed into the
// Position JSON shape consumed by the frontend. Field names match the
// legacy Position model JSON tags so the wire contract is unchanged.
//
// Phase-42 codec uses LocationLatitude / LocationLongitude (compound
// flatten — see codec/flatten.go); Elevation is intentionally absent
// because Tesla Fleet Telemetry does not emit it.
var vehiclePositionMappings = []signal.FieldMapping{
	{Signal: "LocationLatitude", Field: "latitude"},
	{Signal: "LocationLongitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
}

func NewVehicleHandler(vehicleSvc *service.VehicleService, tc *tesla.Client, state signal.StateReader) *VehicleHandler {
	return &VehicleHandler{
		vehicleSvc:  vehicleSvc,
		teslaClient: tc,
		state:       state,
	}
}

// SetTelemetryHandler wires the telemetry handler for streaming-aware state resolution.
func (h *VehicleHandler) SetTelemetryHandler(th *TelemetryHandler) {
	h.telemetryHandler = th
}

func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicles, err := h.vehicleSvc.VehicleRepo().GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to list vehicles"))
		return
	}
	writeJSON(w, http.StatusOK, vehicles)
}

func (h *VehicleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleSvc.VehicleRepo().GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get vehicle")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get vehicle"))
		return
	}
	if vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}
	writeJSON(w, http.StatusOK, vehicle)
}

func (h *VehicleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	if err := h.vehicleSvc.VehicleRepo().Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete vehicle")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to delete vehicle"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *VehicleHandler) SyncFromTesla(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "vehicle.sync_from_tesla")
	defer span.End()

	if suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(ctx); suspended {
		writeAppError(w, r, ErrTeslaAPISuspended)
		return
	}
	if !h.teslaClient.HasValidToken() {
		writeAppError(w, r, ErrTeslaNotConnected)
		return
	}

	synced, err := h.vehicleSvc.SyncFromTesla(ctx, h.teslaClient)
	if err != nil {
		log.Error().Err(err).Msg("failed to sync vehicles from Tesla")
		tracing.EndSpan(span, err)
		writeAppError(w, r, ErrTeslaAPIUnavailable.WithMessage("failed to list vehicles from Tesla API"))
		return
	}
	span.SetAttributes(attribute.Int("tesla.vehicles_synced", len(synced)))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"synced":   len(synced),
		"vehicles": synced,
	})
}

func (h *VehicleHandler) Positions(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	limit, _ := pagination(r)
	from := time.Now().AddDate(0, 0, -7) // default to last 7 days
	to := time.Now()

	// Chart mode: empty CollapseBy so every change-feed emission becomes a
	// row, preserving the legacy flat-pivot semantics consumed by the
	// frontend map/timeline.
	timelineRows, err := h.state.Timeline(r.Context(),
		id, vehiclePositionMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions from signal_log")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get positions"))
		return
	}

	rows := make([]map[string]interface{}, 0, len(timelineRows))
	for _, tr := range timelineRows {
		row := make(map[string]interface{}, len(tr.Fields)+4)
		for k, v := range tr.Fields {
			row[k] = v
		}
		row["ts"] = tr.Timestamp
		rows = append(rows, row)
	}

	// Reverse to newest-first (Timeline returns ascending by ts)
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	// Apply limit after reversal so we keep the most recent positions
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	// Alias ts→created_at and speed_mph→speed for frontend PositionRecord
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			row["id"] = fmt.Sprintf("%v", ts)
		}
		if v, ok := row["speed_mph"]; ok {
			row["speed"] = v
		}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *VehicleHandler) CurrentState(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "vehicle.current_state")
	defer span.End()

	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}
	span.SetAttributes(attribute.Int64("vehicle.id", id))

	vehicle, err := h.vehicleSvc.VehicleRepo().GetByID(ctx, id)
	if err != nil || vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}
	span.SetAttributes(attribute.String("vehicle.vin", vehicle.VIN))

	// Phase-46 / Prompt 64 — point-in-time time-machine view.
	// When the caller passes a valid `?as_of=` query parameter we
	// reconstruct vehicle state from signal_log at that timestamp
	// instead of returning live signal data. The branch is read-only:
	// no writes to the L1 cache or any other store. Validation lives
	// in signal.ParseAsOf so the bounds and lookback policy stay in
	// one place across every handler that gains the same parameter.
	asOf, hasAsOf, asOfErr := signal.ParseAsOf(r.URL.Query(), time.Now())
	if asOfErr != nil {
		writeError(w, http.StatusBadRequest, asOfErr.Error())
		return
	}
	if hasAsOf && h.state != nil {
		snapshot, snapErr := signal.SnapshotAt(ctx, h.state, vehicle.ID, asOf)
		if snapErr != nil {
			log.Error().Err(snapErr).Int64("vehicle_id", vehicle.ID).Time("as_of", asOf).Msg("vehicle current state: snapshot read failed")
			writeError(w, http.StatusInternalServerError, "failed to read snapshot")
			return
		}
		// signal.State is map[string]SignalValue (named alias of any) and
		// signal.Store.Hydrate takes map[string]interface{}. The element
		// types are identical at the runtime level but Go disallows the
		// named-to-unnamed conversion without an element copy.
		raw := make(map[string]interface{}, len(snapshot))
		for k, v := range snapshot {
			raw[k] = v
		}
		store := signal.New()
		store.Hydrate(vehicle.ID, raw)
		state := h.vehicleSvc.BuildStateFromSignalStore(store, vehicle)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"state":       state,
			"live":        false,
			"data_source": "as_of",
			"as_of":       asOf.Format(time.RFC3339),
		})
		return
	}

	// PRIMARY: Build state from the live signal boundary + DB fallbacks.
	if h.telemetryHandler != nil {
		store := signal.New()
		var hasLiveSignals bool
		if liveStore := h.telemetryHandler.GetLiveSignalStore(); liveStore != nil {
			values, err := liveStore.GetAll(ctx, vehicle.ID, signal.LiveSignalReadDistributed)
			if err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("vehicle current state: live signal read failed")
			} else if len(values) > 0 {
				store.Hydrate(vehicle.ID, liveSignalValuesToRaw(values))
				hasLiveSignals = true
			}
		}
		state := h.vehicleSvc.BuildStateFromSignalStore(store, vehicle)
		// Enrich with state-since timestamp from vehicle_states table
		if _, since, err := h.vehicleSvc.StateRepo().GetCurrentStateSince(ctx, vehicle.ID); err == nil && since != nil {
			state.Since = since
		}
		dataSource := "live_signal_store"
		if !hasLiveSignals {
			dataSource = "db_fallback"
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"state":       state,
			"live":        hasLiveSignals,
			"data_source": dataSource,
		})
		return
	}

	// SECONDARY: Build state from DB records (fleet telemetry snapshot tables)
	// Only reached when telemetryHandler is nil (no MQTT configured)
	state := h.vehicleSvc.BuildStateFromSignalStore(nil, vehicle)
	if _, since, err := h.vehicleSvc.StateRepo().GetCurrentStateSince(ctx, vehicle.ID); err == nil && since != nil {
		state.Since = since
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"state":       state,
		"live":        false,
		"data_source": "db_fallback",
	})
}

func (h *VehicleHandler) Wake(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(r.Context()); suspended {
		writeAppError(w, r, ErrTeslaAPISuspended)
		return
	}

	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleSvc.VehicleRepo().GetByID(r.Context(), id)
	if err != nil || vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}

	if err := h.teslaClient.WakeUp(r.Context(), vehicle.VIN); err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to wake vehicle")
		writeAppError(w, r, ErrTeslaAPIUnavailable.WithMessage("failed to wake vehicle"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "waking"})
}
