package api

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"go.opentelemetry.io/otel/attribute"
)

// VehicleHandler handles vehicle-related HTTP requests.
// Business logic (state assembly, Tesla sync) is delegated to
// VehicleService; the handler focuses on HTTP concerns.
type VehicleHandler struct {
	vehicleSvc       *service.VehicleService
	teslaClient      *tesla.Client
	telemetryHandler *TelemetryHandler
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
	positions, err := h.vehicleSvc.PositionRepo().ListByVehicle(r.Context(), id, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get positions"))
		return
	}
	// Apply limit
	if limit > 0 && len(positions) > limit {
		positions = positions[:limit]
	}
	writeJSON(w, http.StatusOK, positions)
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

	// PRIMARY: Build state from in-memory SignalStore + DB fallbacks (never nil, <5ms)
	if h.telemetryHandler != nil {
		store := h.telemetryHandler.GetSignalStore()
		state := h.vehicleSvc.BuildStateFromSignalStore(store, vehicle)
		// Enrich with state-since timestamp from vehicle_states table
		if _, since, err := h.vehicleSvc.StateRepo().GetCurrentStateSince(ctx, vehicle.ID); err == nil && since != nil {
			state.Since = since
		}
		// Determine if we have live telemetry data vs pure DB fallback
		hasLiveSignals := store != nil && len(store.GetAll(vehicle.ID)) > 0
		dataSource := "signal_store"
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
