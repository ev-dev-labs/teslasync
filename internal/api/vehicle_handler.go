package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
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
type VehicleHandler struct {
	vehicleSvc       *service.VehicleService
	teslaClient      *tesla.Client
	telemetryHandler *TelemetryHandler
	signalLogReader  *database.SignalLogReader
}

func NewVehicleHandler(vehicleSvc *service.VehicleService, tc *tesla.Client) *VehicleHandler {
	return &VehicleHandler{
		vehicleSvc:  vehicleSvc,
		teslaClient: tc,
	}
}

// SetTelemetryHandler wires the telemetry handler for streaming-aware state resolution.
func (h *VehicleHandler) SetTelemetryHandler(th *TelemetryHandler) {
	h.telemetryHandler = th
}

// SetSignalLogReader wires the signal log reader for position queries via signal_log.
func (h *VehicleHandler) SetSignalLogReader(slr *database.SignalLogReader) {
	h.signalLogReader = slr
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

	if h.signalLogReader == nil {
		writeAppError(w, r, ErrDBQuery.WithMessage("signal log reader not configured"))
		return
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		id, positionMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions from signal_log")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get positions"))
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	// Reverse to newest-first (query returns ascending by ts)
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
