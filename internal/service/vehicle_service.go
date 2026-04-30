package service

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// SignalSnapshotReader is the minimal interface { ... SnapshotAt(...) } that
// VehicleService consults to backfill state fields the live signal store left
// at their Go zero value after a pod restart. The concrete production type is
// *database.SignalLogReader; tests inject an in-memory fake. Per ADR-001,
// SnapshotAt is the only durable read path — no snapshot tables.
type SignalSnapshotReader interface {
	SnapshotAt(ctx context.Context, vehicleID int64, at time.Time) (map[string]interface{}, error)
}

// VehicleService encapsulates business logic for vehicle state assembly
// and Tesla API synchronisation. Handlers delegate here instead of
// interacting with repositories directly for complex operations.
type VehicleService struct {
	db              *database.DB
	vehicleRepo     *database.VehicleRepo
	positionRepo    *database.PositionRepo
	securityRepo    *database.SecurityRepo
	stateRepo       *database.VehicleStateRepo
	settingsRepo    *database.SettingsRepo
	signalLogReader SignalSnapshotReader
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

// WithSignalLogReader wires a SignalSnapshotReader (typically
// *database.SignalLogReader) used by BuildStateFromSignalStore as a durable
// backstop for fields the live store left at zero (e.g., after a pod
// restart). When unset the fallback is skipped and behavior matches the
// pre-Phase-38 baseline.
func (s *VehicleService) WithSignalLogReader(reader SignalSnapshotReader) *VehicleService {
	s.signalLogReader = reader
	return s
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
		if f, ok := v.Raw.(float64); ok {
			state.Speed = f
		}
	}
	if v := all["Odometer"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.Odometer = f
		}
	}
	if v := all["BatteryLevel"]; v != nil {
		switch bv := v.Raw.(type) {
		case float64:
			state.BatteryLevel = int(bv)
		case int:
			state.BatteryLevel = bv
		}
	}
	if v := all["Soc"]; v != nil && state.BatteryLevel == 0 {
		if f, ok := v.Raw.(float64); ok {
			state.BatteryLevel = int(f)
		}
	}
	if v := all["IdealBatteryRange"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.IdealRange = f
		}
	}
	if v := all["RatedRange"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.RatedRange = f
		}
	}
	if v := all["EstBatteryRange"]; v != nil && state.RatedRange == 0 {
		if f, ok := v.Raw.(float64); ok {
			state.RatedRange = f
		}
	}
	if v := all["InsideTemp"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.InsideTemp = f
		}
	}
	if v := all["OutsideTemp"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.OutsideTemp = f
		}
	}

	// Location from Location map
	if v := all["Location"]; v != nil {
		if loc, ok := v.Raw.(map[string]interface{}); ok {
			if lat, ok := loc["latitude"].(float64); ok {
				state.Latitude = lat
			}
			if lon, ok := loc["longitude"].(float64); ok {
				state.Longitude = lon
			}
		}
	}
	if v := all["Latitude"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.Latitude = f
		}
	}
	if v := all["Longitude"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.Longitude = f
		}
	}
	if v := all["GpsHeading"]; v != nil {
		switch hv := v.Raw.(type) {
		case float64:
			state.Heading = &hv
		case int:
			f := float64(hv)
			state.Heading = &f
		}
	}

	// Power (computed or direct)
	if v := all["Power"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.Power = f
		}
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
		if f, ok := v.Raw.(float64); ok {
			state.IsCharging = f > 1.0
		}
	}
	if v := all["ACChargingPower"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.ChargerPower = f
		}
	}
	if v := all["DCChargingPower"]; v != nil {
		if f, ok := v.Raw.(float64); ok && f > 0 {
			state.ChargerPower = f
		}
	}
	if v := all["ChargeRateMilePerHour"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.ChargeRate = f
		}
	}
	if v := all["TimeToFullCharge"]; v != nil {
		if f, ok := v.Raw.(float64); ok {
			state.TimeToFullChg = f
		}
	}

	// Security
	if v := all["Locked"]; v != nil {
		switch lv := v.Raw.(type) {
		case bool:
			state.IsLocked = lv
		case string:
			state.IsLocked = lv == "true" || lv == "1"
		}
	}
	if v := all["SentryMode"]; v != nil {
		state.SentryMode = enums.ParseEnumBool(v.Raw)
	}

	// Software version
	if v := all["Version"]; v != nil {
		if sv, ok := v.Raw.(string); ok && sv != "" {
			state.SoftwareVersion = sv
		}
	}
	if state.SoftwareVersion == "" {
		if v := all["SoftwareUpdateVersion"]; v != nil {
			if sv, ok := v.Raw.(string); ok && sv != "" {
				state.SoftwareVersion = sv
			}
		}
	}

	// Climate
	if v := all["HvacPower"]; v != nil {
		switch hv := v.Raw.(type) {
		case bool:
			state.IsClimateOn = hv
		case string:
			state.IsClimateOn = enums.ParseHvacPower(hv)
		case float64:
			state.IsClimateOn = hv > 0
		}
	}

	// --- Phase 2: signal_log fallback for fields the live store left at
	// their Go zero value. signal_log is the durable, ADR-001-blessed
	// last-value-per-signal store; reading from snapshot tables (positions,
	// state_snapshots, battery_snapshots, climate_snapshots, etc.) is
	// forbidden. Live values always win — the fallback only fills holes.
	ctx := context.Background()
	if s.signalLogReader != nil {
		snap, err := s.signalLogReader.SnapshotAt(ctx, vehicle.ID, time.Now().UTC())
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("vehicle service: signal_log fallback read failed")
		} else if len(snap) > 0 {
			fillStateFromSnapshot(state, all, snap)
		}
	}

	// --- Phase 3: Vehicle state — fallback from state history.
	if state.State == "" && s.stateRepo != nil {
		if currentState, err := s.stateRepo.GetCurrentState(ctx, vehicle.ID); err == nil && currentState != "" {
			state.State = currentState
		}
	}
	if state.State == "" {
		state.State = enums.StateOnline
	}

	return state
}

// fillStateFromSnapshot backfills VehicleState fields that are still at their
// Go zero value from the signal_log snapshot map. The signal-name → field
// mapping mirrors Phase 1 of BuildStateFromSignalStore so the merged state is
// consistent regardless of which layer supplied each value. Live data is
// always preferred — boolean fields are only filled when the live store had
// no entry for the corresponding signal name (avoiding false-vs-unset
// ambiguity).
func fillStateFromSnapshot(state *models.VehicleState, live map[string]*signal.Value, snap map[string]interface{}) {
	if state.Odometer == 0 {
		if f, ok := snapFloat(snap, "Odometer"); ok {
			state.Odometer = f
		}
	}
	if state.InsideTemp == 0 {
		if f, ok := snapFloat(snap, "InsideTemp"); ok {
			state.InsideTemp = f
		}
	}
	if state.OutsideTemp == 0 {
		if f, ok := snapFloat(snap, "OutsideTemp"); ok {
			state.OutsideTemp = f
		}
	}
	if state.SoftwareVersion == "" {
		if v, ok := snapString(snap, "Version"); ok && v != "" {
			state.SoftwareVersion = v
		} else if v, ok := snapString(snap, "SoftwareUpdateVersion"); ok && v != "" {
			state.SoftwareVersion = v
		}
	}
	if state.IdealRange == 0 {
		if f, ok := snapFloat(snap, "IdealBatteryRange"); ok {
			state.IdealRange = f
		}
	}
	if state.RatedRange == 0 {
		if f, ok := snapFloat(snap, "RatedRange"); ok {
			state.RatedRange = f
		} else if f, ok := snapFloat(snap, "EstBatteryRange"); ok {
			state.RatedRange = f
		}
	}
	if state.Latitude == 0 {
		if f, ok := snapFloat(snap, "Latitude"); ok {
			state.Latitude = f
		}
	}
	if state.Longitude == 0 {
		if f, ok := snapFloat(snap, "Longitude"); ok {
			state.Longitude = f
		}
	}
	if state.BatteryLevel == 0 {
		if f, ok := snapFloat(snap, "BatteryLevel"); ok {
			state.BatteryLevel = int(f)
		} else if f, ok := snapFloat(snap, "Soc"); ok {
			state.BatteryLevel = int(f)
		}
	}
	if state.Speed == 0 {
		if f, ok := snapFloat(snap, "VehicleSpeed"); ok {
			state.Speed = f
		}
	}

	// Boolean and string fields where the Go zero value (false / "") is
	// indistinguishable from "unset". Only fill when the live store did not
	// supply the corresponding signal at all — avoids overwriting a real
	// live `false` with a stale signal_log `true`.
	if _, present := live["Locked"]; !present {
		if b, ok := snapBool(snap, "Locked"); ok {
			state.IsLocked = b
		}
	}
	if _, present := live["SentryMode"]; !present {
		if v, ok := snap["SentryMode"]; ok {
			state.SentryMode = enums.ParseEnumBool(v)
		}
	}
	if _, present := live["HvacPower"]; !present {
		if v, ok := snap["HvacPower"]; ok {
			switch hv := v.(type) {
			case bool:
				state.IsClimateOn = hv
			case string:
				state.IsClimateOn = enums.ParseHvacPower(hv)
			case float64:
				state.IsClimateOn = hv > 0
			}
		}
	}
}

// snapFloat extracts a numeric value from a signal_log snapshot map.
// SnapshotAt returns numbers as float64 (per signal_log_reader_query.go), but
// we accept int / int64 defensively in case the test fake or future readers
// produce them.
func snapFloat(snap map[string]interface{}, key string) (float64, bool) {
	v, ok := snap[key]
	if !ok || v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// snapString extracts a string value from a signal_log snapshot map.
func snapString(snap map[string]interface{}, key string) (string, bool) {
	v, ok := snap[key]
	if !ok || v == nil {
		return "", false
	}
	if s, ok := v.(string); ok {
		return s, true
	}
	return "", false
}

// snapBool extracts a boolean value from a signal_log snapshot map. Strings
// "true"/"1" are accepted to mirror Phase 1 of BuildStateFromSignalStore.
func snapBool(snap map[string]interface{}, key string) (bool, bool) {
	v, ok := snap[key]
	if !ok || v == nil {
		return false, false
	}
	switch b := v.(type) {
	case bool:
		return b, true
	case string:
		return b == "true" || b == "1", true
	}
	return false, false
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
