package api

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleHandler handles vehicle-related HTTP requests.
type VehicleHandler struct {
	vehicleRepo    *database.VehicleRepo
	positionRepo   *database.PositionRepo
	settingsRepo   *database.SettingsRepo
	climateRepo    *database.ClimateRepo
	securityRepo   *database.SecurityRepo
	chargingTelRepo *database.ChargingTelemetryRepo
	stateRepo      *database.VehicleStateRepo
	teslaClient    *tesla.Client
	telemetryHandler *TelemetryHandler
}

func NewVehicleHandler(db *database.DB, tc *tesla.Client) *VehicleHandler {
	return &VehicleHandler{
		vehicleRepo:    database.NewVehicleRepo(db),
		positionRepo:   database.NewPositionRepo(db),
		settingsRepo:   database.NewSettingsRepo(db),
		climateRepo:    database.NewClimateRepo(db),
		securityRepo:   database.NewSecurityRepo(db),
		chargingTelRepo: database.NewChargingTelemetryRepo(db),
		stateRepo:      database.NewVehicleStateRepo(db),
		teslaClient:    tc,
	}
}

// SetTelemetryHandler wires the telemetry handler for streaming-aware state resolution.
func (h *VehicleHandler) SetTelemetryHandler(th *TelemetryHandler) {
	h.telemetryHandler = th
}

func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicles, err := h.vehicleRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles")
		writeError(w, http.StatusInternalServerError, "failed to list vehicles")
		return
	}
	writeJSON(w, http.StatusOK, vehicles)
}

func (h *VehicleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get vehicle")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle")
		return
	}
	if vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}
	writeJSON(w, http.StatusOK, vehicle)
}

func (h *VehicleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	if err := h.vehicleRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete vehicle")
		writeError(w, http.StatusInternalServerError, "failed to delete vehicle")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *VehicleHandler) SyncFromTesla(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		writeError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicles, err := h.teslaClient.ListVehicles(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list Tesla vehicles")
		writeError(w, http.StatusBadGateway, "failed to list vehicles from Tesla API")
		return
	}

	var synced []*models.Vehicle
	for _, tv := range vehicles {
		existing, _ := h.vehicleRepo.GetByID(r.Context(), tv.VehicleID)
		if existing != nil {
			synced = append(synced, existing)
			continue
		}

		v := &models.Vehicle{
			VehicleID:   tv.VehicleID,
			VIN:         tv.VIN,
			DisplayName: tv.DisplayName,
			State:       tv.State,
			Healthy:     true,
		}
		if err := h.vehicleRepo.Create(r.Context(), v); err != nil {
			log.Error().Err(err).Str("vin", tv.VIN).Msg("failed to create vehicle")
			continue
		}
		synced = append(synced, v)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"synced":  len(synced),
		"vehicles": synced,
	})
}

func (h *VehicleHandler) Positions(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	limit, offset := pagination(r)
	positions, err := h.positionRepo.GetByVehicle(r.Context(), id, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions")
		writeError(w, http.StatusInternalServerError, "failed to get positions")
		return
	}
	writeJSON(w, http.StatusOK, positions)
}

func (h *VehicleHandler) CurrentState(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), id)
	if err != nil || vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	// PRIMARY: If fleet telemetry is streaming for this vehicle, build state from DB
	if h.telemetryHandler != nil && h.telemetryHandler.IsVehicleStreaming(vehicle.VIN) {
		state := h.buildStateFromDB(r, vehicle)
		if state != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"state":       state,
				"live":        true,
				"data_source": "fleet_telemetry",
			})
			return
		}
		// If DB state build failed, fall through to API
	}

	// FALLBACK: Use Tesla Fleet API
	suspended, _ := h.settingsRepo.IsAPISuspended(r.Context())
	if suspended || !h.teslaClient.HasValidToken() {
		pos, _ := h.positionRepo.GetLatest(r.Context(), id)
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
		pos, _ := h.positionRepo.GetLatest(r.Context(), id)
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

// buildStateFromDB constructs a VehicleState from the latest DB records
// written by fleet telemetry. Returns nil if no data available.
func (h *VehicleHandler) buildStateFromDB(r *http.Request, vehicle *models.Vehicle) *models.VehicleState {
	ctx := r.Context()

	pos, err := h.positionRepo.GetLatest(ctx, vehicle.ID)
	if err != nil || pos == nil {
		return nil
	}

	// Determine vehicle state from state history
	currentState, _ := h.stateRepo.GetCurrentState(ctx, vehicle.ID)
	if currentState == "" {
		currentState = "online"
	}

	state := &models.VehicleState{
		VehicleID:    vehicle.ID,
		State:        currentState,
		Latitude:     pos.Latitude,
		Longitude:    pos.Longitude,
		BatteryLevel: pos.BatteryLvl,
		Odometer:     pos.Odometer,
	}

	// Fill from position if available
	if pos.Speed != nil {
		state.Speed = float64(*pos.Speed)
	}
	if pos.Power != nil {
		state.Power = float64(*pos.Power)
	}
	if pos.RatedRange != nil {
		state.RatedRange = *pos.RatedRange
	}
	if pos.IdealRange != nil {
		state.IdealRange = *pos.IdealRange
	}
	if pos.InsideTemp != nil {
		state.InsideTemp = *pos.InsideTemp
	}
	if pos.OutsideTemp != nil {
		state.OutsideTemp = *pos.OutsideTemp
	}
	if pos.IsClimate != nil {
		state.IsClimateOn = *pos.IsClimate
	}

	// Enrich with climate snapshot (more detailed than position)
	if climate, err := h.climateRepo.GetLatest(ctx, vehicle.ID); err == nil && climate != nil {
		if climate.InsideTemp != nil {
			state.InsideTemp = *climate.InsideTemp
		}
		if climate.OutsideTemp != nil {
			state.OutsideTemp = *climate.OutsideTemp
		}
		state.IsClimateOn = (climate.HvacPower != nil && *climate.HvacPower > 0)
	}

	// Enrich with security snapshot
	if sec, err := h.securityRepo.GetLatest(ctx, vehicle.ID); err == nil && sec != nil {
		if sec.Locked != nil {
			state.IsLocked = *sec.Locked
		}
		if sec.SentryMode != nil {
			state.SentryMode = *sec.SentryMode
		}
	}

	// Enrich with charging telemetry
	if currentState == "charging" {
		state.IsCharging = true
		if ct, err := h.chargingTelRepo.GetLatest(ctx, vehicle.ID); err == nil && ct != nil {
			if ct.ChargeRateMph != nil {
				state.ChargeRate = *ct.ChargeRateMph
			}
			power := 0.0
			if ct.DCChargingPower != nil && *ct.DCChargingPower > 0 {
				power = *ct.DCChargingPower
			} else if ct.ACChargingPower != nil {
				power = *ct.ACChargingPower
			} else if ct.ChargeAmps != nil && ct.ChargerVoltage != nil {
				power = (*ct.ChargeAmps * *ct.ChargerVoltage) / 1000.0
			}
			state.ChargerPower = power
			if ct.TimeToFullCharge != nil {
				state.TimeToFullChg = *ct.TimeToFullCharge
			}
		}
	}

	// Software version not available from telemetry — leave empty
	state.SoftwareVersion = ""

	return state
}

func (h *VehicleHandler) Wake(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		writeError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}

	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), id)
	if err != nil || vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	if err := h.teslaClient.WakeUp(r.Context(), vehicle.VIN); err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to wake vehicle")
		writeError(w, http.StatusBadGateway, "failed to wake vehicle")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "waking"})
}
