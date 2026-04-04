package api

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/models"
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
	// Check if vehicle_discovery endpoint is enabled in polling config (on-demand)
	if pc, err := h.vehicleSvc.SettingsRepo().GetPollingConfig(ctx); err == nil && !pc.OnDemandVehicleDiscovery {
		writeAppError(w, r, ErrTeslaEndpointDisabled.WithMessage("vehicle discovery endpoint is disabled in polling config"))
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

	limit, offset := pagination(r)
	positions, err := h.vehicleSvc.PositionRepo().GetByVehicle(r.Context(), id, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get positions"))
		return
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

	// PRIMARY: If fleet telemetry is streaming for this vehicle, try to build state from DB
	// but fall through to API if core data (position) is stale
	telemetryStreaming := h.telemetryHandler != nil && h.telemetryHandler.IsVehicleStreaming(vehicle.VIN)
	if telemetryStreaming {
		state := h.vehicleSvc.BuildStateFromDB(r.Context(), vehicle)
		if state != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"state":       state,
				"live":        true,
				"data_source": "fleet_telemetry",
			})
			return
		}
		// If DB state build failed (stale/missing data), fall through to API
	}

	// FALLBACK: Use Tesla Fleet API (also used when telemetry data is stale)
	suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(r.Context())
	if suspended || !h.teslaClient.HasValidToken() {
		pos, _ := h.vehicleSvc.PositionRepo().GetLatest(r.Context(), id)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle":     vehicle,
			"position":    pos,
			"live":        false,
			"suspended":   suspended,
			"data_source": "cached",
		})
		return
	}

	data, err := h.teslaClient.GetVehicleData(r.Context(), vehicle.VIN)
	if err != nil {
		pos, _ := h.vehicleSvc.PositionRepo().GetLatest(r.Context(), id)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle":     vehicle,
			"position":    pos,
			"live":        false,
			"error":       err.Error(),
			"data_source": "cached",
		})
		return
	}

	state := &models.VehicleState{
		VehicleID:       vehicle.ID,
		State:           data.State,
		Latitude:        data.DriveState.Latitude,
		Longitude:       data.DriveState.Longitude,
		BatteryLevel:    data.ChargeState.BatteryLevel,
		RatedRange:      data.ChargeState.BatteryRange,
		IdealRange:      data.ChargeState.IdealBatteryRange,
		Odometer:        data.VehicleState.Odometer,
		InsideTemp:      data.ClimateState.InsideTemp,
		OutsideTemp:     data.ClimateState.OutsideTemp,
		IsClimateOn:     data.ClimateState.IsClimateOn,
		IsCharging:      data.ChargeState.ChargingState == "Charging",
		ChargerPower:    data.ChargeState.ChargerPower,
		ChargeRate:      data.ChargeState.ChargeRate,
		TimeToFullChg:   data.ChargeState.TimeToFullCharge,
		IsLocked:        data.VehicleState.Locked,
		SentryMode:      data.VehicleState.SentryMode,
		SoftwareVersion: data.VehicleState.SoftwareUpdate.Version,
	}
	if data.DriveState.Speed != nil {
		state.Speed = float64(*data.DriveState.Speed)
	}
	state.Power = float64(data.DriveState.Power)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"state":       state,
		"live":        true,
		"data_source": "fleet_api",
	})
}

func (h *VehicleHandler) Wake(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(r.Context()); suspended {
		writeAppError(w, r, ErrTeslaAPISuspended)
		return
	}
	// Check if wake_up endpoint is enabled in polling config
	if pc, err := h.vehicleSvc.SettingsRepo().GetPollingConfig(r.Context()); err == nil && !pc.WakeUp {
		writeAppError(w, r, ErrTeslaEndpointDisabled.WithMessage("wake_up endpoint is disabled in polling config"))
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
