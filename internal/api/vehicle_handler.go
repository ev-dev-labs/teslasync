package api

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleHandler handles vehicle-related HTTP requests.
type VehicleHandler struct {
	vehicleRepo  *database.VehicleRepo
	positionRepo *database.PositionRepo
	teslaClient  *tesla.Client
	cache        *database.Cache
}

func NewVehicleHandler(db *database.DB, tc *tesla.Client, cache *database.Cache) *VehicleHandler {
	return &VehicleHandler{
		vehicleRepo:  database.NewVehicleRepo(db),
		positionRepo: database.NewPositionRepo(db),
		teslaClient:  tc,
		cache:        cache,
	}
}

func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "vehicles:all"

	var vehicles []*models.Vehicle
	if h.cache.Get(ctx, cacheKey, &vehicles) {
		writeJSON(w, http.StatusOK, vehicles)
		return
	}

	var err error
	vehicles, err = h.vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles")
		writeError(w, http.StatusInternalServerError, "failed to list vehicles")
		return
	}

	h.cache.Set(ctx, cacheKey, vehicles, 60*time.Second)
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
	h.cache.Delete(context.Background(), "vehicles:all")
	w.WriteHeader(http.StatusNoContent)
}

func (h *VehicleHandler) SyncFromTesla(w http.ResponseWriter, r *http.Request) {
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
	// Invalidate vehicle list cache after sync
	h.cache.Delete(context.Background(), "vehicles:all")
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

	if !h.teslaClient.HasValidToken() {
		// Return last known position as fallback
		pos, _ := h.positionRepo.GetLatest(r.Context(), id)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle": vehicle,
			"position": pos,
			"live":    false,
		})
		return
	}

	data, err := h.teslaClient.GetVehicleData(r.Context(), vehicle.VehicleID)
	if err != nil {
		pos, _ := h.positionRepo.GetLatest(r.Context(), id)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle": vehicle,
			"position": pos,
			"live":    false,
			"error":   err.Error(),
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
		"state": state,
		"live":  true,
	})
}

func (h *VehicleHandler) Wake(w http.ResponseWriter, r *http.Request) {
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

	if err := h.teslaClient.WakeUp(r.Context(), vehicle.VehicleID); err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to wake vehicle")
		writeError(w, http.StatusBadGateway, "failed to wake vehicle")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "waking"})
}
