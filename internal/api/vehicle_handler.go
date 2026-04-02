package api

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"go.opentelemetry.io/otel/attribute"
)

// VehicleHandler handles vehicle-related HTTP requests.
type VehicleHandler struct {
	vehicleRepo      *database.VehicleRepo
	positionRepo     *database.PositionRepo
	settingsRepo     *database.SettingsRepo
	climateRepo      *database.ClimateRepo
	securityRepo     *database.SecurityRepo
	chargingTelRepo  *database.ChargingTelemetryRepo
	stateRepo        *database.VehicleStateRepo
	vehicleConfigRepo *database.VehicleConfigRepo
	teslaClient      *tesla.Client
	telemetryHandler *TelemetryHandler
}

func NewVehicleHandler(db *database.DB, tc *tesla.Client) *VehicleHandler {
	return &VehicleHandler{
		vehicleRepo:      database.NewVehicleRepo(db),
		positionRepo:     database.NewPositionRepo(db),
		settingsRepo:     database.NewSettingsRepo(db),
		climateRepo:      database.NewClimateRepo(db),
		securityRepo:     database.NewSecurityRepo(db),
		chargingTelRepo:  database.NewChargingTelemetryRepo(db),
		stateRepo:        database.NewVehicleStateRepo(db),
		vehicleConfigRepo: database.NewVehicleConfigRepo(db),
		teslaClient:      tc,
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

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), id)
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

	if err := h.vehicleRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete vehicle")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to delete vehicle"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *VehicleHandler) SyncFromTesla(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "vehicle.sync_from_tesla")
	defer span.End()

	if suspended, _ := h.settingsRepo.IsAPISuspended(ctx); suspended {
		writeAppError(w, r, ErrTeslaAPISuspended)
		return
	}
	if !h.teslaClient.HasValidToken() {
		writeAppError(w, r, ErrTeslaNotConnected)
		return
	}

	vehicles, err := h.teslaClient.ListVehicles(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list Tesla vehicles")
		tracing.EndSpan(span, err)
		writeAppError(w, r, ErrTeslaAPIUnavailable.WithMessage("failed to list vehicles from Tesla API"))
		return
	}
	span.SetAttributes(attribute.Int("tesla.vehicles_found", len(vehicles)))

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
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	limit, offset := pagination(r)
	positions, err := h.positionRepo.GetByVehicle(r.Context(), id, limit, offset)
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

	vehicle, err := h.vehicleRepo.GetByID(ctx, id)
	if err != nil || vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}
	span.SetAttributes(attribute.String("vehicle.vin", vehicle.VIN))

	// PRIMARY: If fleet telemetry is streaming for this vehicle, try to build state from DB
	// but fall through to API if core data (position) is stale
	telemetryStreaming := h.telemetryHandler != nil && h.telemetryHandler.IsVehicleStreaming(vehicle.VIN)
	if telemetryStreaming {
		state := h.buildStateFromDB(r, vehicle)
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
// written by fleet telemetry. Returns nil if position data is stale (>5 min)
// or missing, signaling the caller to fall back to Fleet API.
func (h *VehicleHandler) buildStateFromDB(r *http.Request, vehicle *models.Vehicle) *models.VehicleState {
	ctx := r.Context()

	pos, err := h.positionRepo.GetLatest(ctx, vehicle.ID)
	if err != nil || pos == nil {
		return nil
	}

	// If position is stale (>5 min), telemetry isn't providing full data — fall back to API
	if time.Since(pos.CreatedAt) > 5*time.Minute {
		// Check if charging telemetry is fresh even if position isn't
		ct, ctErr := h.chargingTelRepo.GetLatest(ctx, vehicle.ID)
		if ctErr != nil || ct == nil || time.Since(ct.CreatedAt) > 5*time.Minute {
			return nil // all data stale, use API
		}
		// Charging telemetry is fresh — build state from it + stale position as base
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

	// Enrich with charging telemetry (always check — may have fresher battery data)
	// Merge last 20 records to get composite view (vehicle sends different signals per batch)
	if ct, err := h.chargingTelRepo.GetLatestMerged(ctx, vehicle.ID, 20); err == nil && ct != nil {
		// Use charging telemetry battery level / SOC if fresher than position
		if ct.CreatedAt.After(pos.CreatedAt) {
			if ct.BatteryLevel != nil {
				state.BatteryLevel = int(*ct.BatteryLevel)
			} else if ct.Soc != nil {
				state.BatteryLevel = int(*ct.Soc)
			}
		}
		// Override range from charging telemetry if available
		if ct.RatedRange != nil {
			state.RatedRange = *ct.RatedRange
		}
		if ct.EstBatteryRange != nil && state.RatedRange == 0 {
			state.RatedRange = *ct.EstBatteryRange
		}
		if ct.IdealBatteryRange != nil {
			state.IdealRange = *ct.IdealBatteryRange
		}

		// Detect charging from telemetry data — check multiple indicators
		isCharging := false
		if ct.ChargeRateMph != nil && *ct.ChargeRateMph > 0 {
			isCharging = true
		}
		if ct.ChargeAmps != nil && *ct.ChargeAmps > 0 {
			isCharging = true
		}
		if ct.ChargerVoltage != nil && *ct.ChargerVoltage > 0 {
			isCharging = true
		}
		if ct.DCChargingPower != nil && *ct.DCChargingPower > 0 {
			isCharging = true
		}
		if ct.ACChargingPower != nil && *ct.ACChargingPower > 0 {
			isCharging = true
		}
		if ct.ChargeState != nil {
			cs := *ct.ChargeState
			if cs == "Charging" || cs == "Starting" {
				isCharging = true
			}
		}
		// Fresh charging telemetry record itself implies charging
		if time.Since(ct.CreatedAt) < 2*time.Minute {
			isCharging = true
		}

		if isCharging {
			state.IsCharging = true
			state.State = "charging"
			if ct.ChargeRateMph != nil {
				state.ChargeRate = *ct.ChargeRateMph
			}
			power := 0.0
			if ct.DCChargingPower != nil && *ct.DCChargingPower > 0 {
				power = *ct.DCChargingPower
			} else if ct.ACChargingPower != nil && *ct.ACChargingPower > 0 {
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

	// Enrich with firmware version from vehicle config snapshots
	if cfg, err := h.vehicleConfigRepo.GetLatest(ctx, vehicle.ID); err == nil && cfg != nil {
		if cfg.SoftwareUpdateVersion != nil && *cfg.SoftwareUpdateVersion != "" {
			state.SoftwareVersion = *cfg.SoftwareUpdateVersion
		} else if cfg.Version != nil && *cfg.Version != "" {
			state.SoftwareVersion = *cfg.Version
		}
	}

	return state
}

func (h *VehicleHandler) Wake(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		writeAppError(w, r, ErrTeslaAPISuspended)
		return
	}

	id, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), id)
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
