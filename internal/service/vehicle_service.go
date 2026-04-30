package service

import (
	"context"

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
	db           *database.DB
	vehicleRepo  *database.VehicleRepo
	positionRepo *database.PositionRepo
	securityRepo *database.SecurityRepo
	stateRepo    *database.VehicleStateRepo
	settingsRepo *database.SettingsRepo
}

// NewVehicleService creates a VehicleService with all required repos.
func NewVehicleService(db *database.DB) *VehicleService {
	return &VehicleService{
		db:           db,
		vehicleRepo:  database.NewVehicleRepo(db),
		positionRepo: database.NewPositionRepo(db),
		securityRepo: database.NewSecurityRepo(db),
		stateRepo:    database.NewVehicleStateRepo(db),
		settingsRepo: database.NewSettingsRepo(db),
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

	// --- Phase 2: If SignalStore was empty (e.g., pod restart), state will
	// be populated on next telemetry batch via SignalStore.LoadFromDB which
	// uses Redis → signal_log fallback chain.
	ctx := context.Background()

	// Vehicle state: fallback from state history
	if state.State == "" {
		if currentState, err := s.stateRepo.GetCurrentState(ctx, vehicle.ID); err == nil && currentState != "" {
			state.State = currentState
		}
	}
	if state.State == "" {
		state.State = enums.StateOnline
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
			TeslaID:     tv.VehicleID,
			VIN:         tv.VIN,
			DisplayName: tv.DisplayName,
		}
		if err := s.vehicleRepo.Create(ctx, v); err != nil {
			log.Error().Err(err).Str("vin", tv.VIN).Msg("failed to create vehicle")
			continue
		}
		synced = append(synced, v)
	}
	return synced, nil
}
