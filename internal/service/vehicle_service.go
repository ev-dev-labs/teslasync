package service

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleService encapsulates business logic for vehicle state assembly
// and Tesla API synchronisation. Handlers delegate here instead of
// interacting with repositories directly for complex operations.
type VehicleService struct {
	db                *database.DB
	vehicleRepo       *database.VehicleRepo
	positionRepo      *database.PositionRepo
	climateRepo       *database.ClimateRepo
	securityRepo      *database.SecurityRepo
	chargingTelRepo   *database.ChargingTelemetryRepo
	stateRepo         *database.VehicleStateRepo
	vehicleConfigRepo *database.VehicleConfigRepo
	settingsRepo      *database.SettingsRepo
	liveStateRepo     *database.LiveStateRepo
}

// NewVehicleService creates a VehicleService with all required repos.
func NewVehicleService(db *database.DB) *VehicleService {
	return &VehicleService{
		db:                db,
		vehicleRepo:       database.NewVehicleRepo(db),
		positionRepo:      database.NewPositionRepo(db),
		climateRepo:       database.NewClimateRepo(db),
		securityRepo:      database.NewSecurityRepo(db),
		chargingTelRepo:   database.NewChargingTelemetryRepo(db),
		stateRepo:         database.NewVehicleStateRepo(db),
		vehicleConfigRepo: database.NewVehicleConfigRepo(db),
		settingsRepo:      database.NewSettingsRepo(db),
		liveStateRepo:     database.NewLiveStateRepo(db),
	}
}

// PositionRepo returns the underlying position repository for simple CRUD
// operations that don't warrant a service method (e.g. paginated listing).
func (s *VehicleService) PositionRepo() *database.PositionRepo {
	return s.positionRepo
}

// VehicleRepo returns the underlying vehicle repository for simple CRUD.
func (s *VehicleService) VehicleRepo() *database.VehicleRepo {
	return s.vehicleRepo
}

// SettingsRepo returns the underlying settings repository for simple lookups.
func (s *VehicleService) SettingsRepo() *database.SettingsRepo {
	return s.settingsRepo
}

// StateRepo returns the vehicle state repository.
func (s *VehicleService) StateRepo() *database.VehicleStateRepo {
	return s.stateRepo
}

// BuildStateFromSignalStore constructs a VehicleState from the in-memory
// SignalStore, with comprehensive DB fallbacks for every field.
// NEVER returns nil — always builds a complete state from whatever data
// is available (SignalStore → snapshot tables → zero defaults).
func (s *VehicleService) BuildStateFromSignalStore(store *signal.Store, vehicle *models.Vehicle) *models.VehicleState {
	state := &models.VehicleState{
		VehicleID: vehicle.ID,
		State:     vehicle.State,
	}

	// Collect signals from store (may be empty after pod restart)
	var all map[string]*signal.Value
	if store != nil {
		all = store.GetAll(vehicle.ID)
	}
	if all == nil {
		all = make(map[string]*signal.Value)
	}

	// --- Phase 1: Read every field from SignalStore ---

	if v := all["VehicleSpeed"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.Speed = f }
	}
	if v := all["Odometer"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.Odometer = f }
	}
	if v := all["BatteryLevel"]; v != nil {
		switch bv := v.Raw.(type) {
		case float64: state.BatteryLevel = int(bv)
		case int: state.BatteryLevel = bv
		}
	}
	if v := all["Soc"]; v != nil && state.BatteryLevel == 0 {
		if f, ok := v.Raw.(float64); ok { state.BatteryLevel = int(f) }
	}
	if v := all["IdealBatteryRange"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.IdealRange = f }
	}
	if v := all["RatedRange"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.RatedRange = f }
	}
	if v := all["EstBatteryRange"]; v != nil && state.RatedRange == 0 {
		if f, ok := v.Raw.(float64); ok { state.RatedRange = f }
	}
	if v := all["InsideTemp"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.InsideTemp = f }
	}
	if v := all["OutsideTemp"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.OutsideTemp = f }
	}

	// Location from Location map
	if v := all["Location"]; v != nil {
		if loc, ok := v.Raw.(map[string]interface{}); ok {
			if lat, ok := loc["latitude"].(float64); ok { state.Latitude = lat }
			if lon, ok := loc["longitude"].(float64); ok { state.Longitude = lon }
		}
	}
	if v := all["Latitude"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.Latitude = f }
	}
	if v := all["Longitude"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.Longitude = f }
	}
	if v := all["GpsHeading"]; v != nil {
		switch hv := v.Raw.(type) {
		case float64: state.Heading = &hv
		case int: f := float64(hv); state.Heading = &f
		}
	}

	// Power (computed or direct)
	if v := all["Power"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.Power = f }
	} else if pv, pcv := all["PackVoltage"], all["PackCurrent"]; pv != nil && pcv != nil {
		if voltage, ok := pv.Raw.(float64); ok {
			if current, ok := pcv.Raw.(float64); ok {
				state.Power = voltage * current / 1000.0
			}
		}
	}

	// Charging state
	if v := all["DetailedChargeState"]; v != nil {
		if cs, ok := v.Raw.(string); ok {
			state.IsCharging = enums.IsCharging(cs)
		}
	}
	if v := all["ChargeAmps"]; v != nil && !state.IsCharging {
		if f, ok := v.Raw.(float64); ok { state.IsCharging = f > 1.0 }
	}
	if v := all["ACChargingPower"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.ChargerPower = f }
	}
	if v := all["DCChargingPower"]; v != nil {
		if f, ok := v.Raw.(float64); ok && f > 0 { state.ChargerPower = f }
	}
	if v := all["ChargeRateMilePerHour"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.ChargeRate = f }
	}
	if v := all["TimeToFullCharge"]; v != nil {
		if f, ok := v.Raw.(float64); ok { state.TimeToFullChg = f }
	}

	// Security
	if v := all["Locked"]; v != nil {
		switch lv := v.Raw.(type) {
		case bool: state.IsLocked = lv
		case string: state.IsLocked = lv == "true" || lv == "1"
		}
	}
	if v := all["SentryMode"]; v != nil {
		state.SentryMode = enums.ParseEnumBool(v.Raw)
	}

	// Software version
	if v := all["Version"]; v != nil {
		if sv, ok := v.Raw.(string); ok && sv != "" { state.SoftwareVersion = sv }
	}
	if state.SoftwareVersion == "" {
		if v := all["SoftwareUpdateVersion"]; v != nil {
			if sv, ok := v.Raw.(string); ok && sv != "" { state.SoftwareVersion = sv }
		}
	}

	// Climate
	if v := all["HvacPower"]; v != nil {
		switch hv := v.Raw.(type) {
		case bool: state.IsClimateOn = hv
		case string: state.IsClimateOn = enums.ParseHvacPower(hv)
		case float64: state.IsClimateOn = hv > 0
		}
	}

	// --- Phase 2: If SignalStore was empty (e.g., pod restart), load from
	// vehicle_live_state (single source of truth, always current) and re-run
	// signal parsing. This replaces scattered fallback queries to individual
	// snapshot tables (positions, climate_snapshots, security_events, etc.)
	// that could return inconsistent data.
	ctx := context.Background()
	if len(all) == 0 {
		if liveSignals, err := s.liveStateRepo.LoadLiveState(ctx, vehicle.ID); err == nil && len(liveSignals) > 0 {
			// Convert map[string]interface{} → map[string]*signal.Value
			for k, v := range liveSignals {
				all[k] = &signal.Value{Raw: v, Timestamp: time.Now()}
			}
			// Re-run Phase 1 with live_state data to populate all state fields
			if v := all["VehicleSpeed"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.Speed = f }
			}
			if v := all["Odometer"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.Odometer = f }
			}
			if v := all["BatteryLevel"]; v != nil {
				switch bv := v.Raw.(type) {
				case float64: state.BatteryLevel = int(bv)
				case int: state.BatteryLevel = bv
				}
			}
			if v := all["Soc"]; v != nil && state.BatteryLevel == 0 {
				if f, ok := v.Raw.(float64); ok { state.BatteryLevel = int(f) }
			}
			if v := all["IdealBatteryRange"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.IdealRange = f }
			}
			if v := all["RatedRange"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.RatedRange = f }
			}
			if v := all["EstBatteryRange"]; v != nil && state.RatedRange == 0 {
				if f, ok := v.Raw.(float64); ok { state.RatedRange = f }
			}
			if v := all["InsideTemp"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.InsideTemp = f }
			}
			if v := all["OutsideTemp"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.OutsideTemp = f }
			}
			if v := all["Latitude"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.Latitude = f }
			}
			if v := all["Longitude"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.Longitude = f }
			}
			if v := all["GpsHeading"]; v != nil {
				switch hv := v.Raw.(type) {
				case float64: state.Heading = &hv
				case int: f := float64(hv); state.Heading = &f
				}
			}
			if v := all["Power"]; v != nil {
				if f, ok := v.Raw.(float64); ok { state.Power = f }
			}
			if v := all["DetailedChargeState"]; v != nil {
				if cs, ok := v.Raw.(string); ok { state.IsCharging = enums.IsCharging(cs) }
			}
			if v := all["Locked"]; v != nil {
				switch lv := v.Raw.(type) {
				case bool: state.IsLocked = lv
				case string: state.IsLocked = lv == "true" || lv == "1"
				}
			}
			if v := all["SentryMode"]; v != nil {
				state.SentryMode = enums.ParseEnumBool(v.Raw)
			}
			if v := all["Version"]; v != nil {
				if sv, ok := v.Raw.(string); ok && sv != "" { state.SoftwareVersion = sv }
			}
			if v := all["HvacPower"]; v != nil {
				switch hv := v.Raw.(type) {
				case bool: state.IsClimateOn = hv
				case string: state.IsClimateOn = enums.ParseHvacPower(hv)
				case float64: state.IsClimateOn = hv > 0
				}
			}
			log.Debug().Int64("vehicleID", vehicle.ID).Int("signals", len(liveSignals)).Msg("state built from vehicle_live_state")
		}
	}

	// Vehicle state: fallback from state history
	if state.State == "" {
		if currentState, err := s.stateRepo.GetCurrentState(ctx, vehicle.ID); err == nil && currentState != "" {
			state.State = currentState
		}
	}
	if state.State == "" {
		state.State = "online"
	}

	return state
}

// BuildStateFromDB constructs a VehicleState from the latest DB records
// written by fleet telemetry. Returns nil if position data is stale (>5 min)
// or missing, signalling the caller to fall back to the Fleet API.
func (s *VehicleService) BuildStateFromDB(ctx context.Context, vehicle *models.Vehicle) *models.VehicleState {
	pos, err := s.positionRepo.GetLatest(ctx, vehicle.ID)
	if err != nil || pos == nil {
		return nil
	}

	// If position is stale (>5 min), telemetry isn't providing full data — fall back to API
	if time.Since(pos.CreatedAt) > 5*time.Minute {
		// Check if charging telemetry is fresh even if position isn't
		ct, ctErr := s.chargingTelRepo.GetLatest(ctx, vehicle.ID)
		if ctErr != nil || ct == nil || time.Since(ct.CreatedAt) > 5*time.Minute {
			return nil // all data stale, use API
		}
		// Charging telemetry is fresh — build state from it + stale position as base
	}

	// Determine vehicle state from state history
	currentState, _ := s.stateRepo.GetCurrentState(ctx, vehicle.ID)
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
	if climate, err := s.climateRepo.GetLatest(ctx, vehicle.ID); err == nil && climate != nil {
		if climate.InsideTemp != nil {
			state.InsideTemp = *climate.InsideTemp
		}
		if climate.OutsideTemp != nil {
			state.OutsideTemp = *climate.OutsideTemp
		}
		state.IsClimateOn = (climate.HvacPower != nil && *climate.HvacPower > 0)
	}

	// Enrich with security snapshot
	if sec, err := s.securityRepo.GetLatest(ctx, vehicle.ID); err == nil && sec != nil {
		if sec.Locked != nil {
			state.IsLocked = *sec.Locked
		}
		if sec.SentryMode != nil {
			state.SentryMode = *sec.SentryMode
		}
	}

	// Enrich with charging telemetry (always check — may have fresher battery data)
	// Merge last 20 records to get composite view (vehicle sends different signals per batch)
	if ct, err := s.chargingTelRepo.GetLatestMerged(ctx, vehicle.ID, 20); err == nil && ct != nil {
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
	if cfg, err := s.vehicleConfigRepo.GetLatest(ctx, vehicle.ID); err == nil && cfg != nil {
		if cfg.SoftwareUpdateVersion != nil && *cfg.SoftwareUpdateVersion != "" {
			state.SoftwareVersion = *cfg.SoftwareUpdateVersion
		} else if cfg.Version != nil && *cfg.Version != "" {
			state.SoftwareVersion = *cfg.Version
		}
	}

	return state
}

// SyncFromTesla discovers vehicles via the Tesla API and upserts them
// into the database. Returns the list of synced vehicles (existing + new).
func (s *VehicleService) SyncFromTesla(ctx context.Context, teslaClient *tesla.Client) ([]*models.Vehicle, error) {
	vehicles, err := teslaClient.ListVehicles(ctx)
	if err != nil {
		return nil, err
	}

	var synced []*models.Vehicle
	for _, tv := range vehicles {
		existing, _ := s.vehicleRepo.GetByID(ctx, tv.VehicleID)
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
		if err := s.vehicleRepo.Create(ctx, v); err != nil {
			log.Error().Err(err).Str("vin", tv.VIN).Msg("failed to create vehicle")
			continue
		}
		synced = append(synced, v)
	}
	return synced, nil
}
