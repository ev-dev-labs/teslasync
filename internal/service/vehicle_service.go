package service

import (
	"context"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/database"

	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// SignalStateReader backfills fields that the live signal store left at
// their Go zero value after a pod restart. The production implementation is
// signal.LogStateReader; tests inject an in-memory fake. Per ADR-002,
// signal_log reads through the StateReader contract are the only durable
// point-in-time state path — no snapshot tables.
type SignalStateReader interface {
	State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
}

// VehicleService encapsulates business logic for vehicle state assembly
// and Tesla API synchronisation. Handlers delegate here instead of
// interacting with repositories directly for complex operations.
type VehicleService struct {
	db            *database.DB
	vehicleRepo   *vehicledb.VehicleRepo
	positionRepo  *positiondb.PositionRepo
	settingsRepo  *settingsdb.SettingsRepo
	stateProvider *vehicleStateProvider
	state         SignalStateReader
}

// NewVehicleService creates a VehicleService with all required repos.
// Current vehicle state is derived from the FSM plus signal.StateReader;
// vehicleStateProvider exposes a thin fsm_transitions-backed "since when"
// lookup for handlers that still need it.
func NewVehicleService(db *database.DB) *VehicleService {
	return &VehicleService{
		db:            db,
		vehicleRepo:   vehicledb.NewVehicleRepo(db),
		positionRepo:  positiondb.NewPositionRepo(db),
		settingsRepo:  settingsdb.NewSettingsRepo(db),
		stateProvider: &vehicleStateProvider{db: db},
	}
}

// WithStateReader wires the durable fallback used by BuildStateFromSignalStore
// for fields the live store left at zero, such as after a pod restart. When
// unset, the fallback is skipped.
func (s *VehicleService) WithStateReader(reader SignalStateReader) *VehicleService {
	s.state = reader
	return s
}

// PositionRepo returns the underlying position repository for simple CRUD
// operations that don't warrant a service method (e.g. paginated listing).
func (s *VehicleService) PositionRepo() *positiondb.PositionRepo {
	return s.positionRepo
}

// VehicleRepo returns the underlying vehicle repository for simple CRUD.
func (s *VehicleService) VehicleRepo() *vehicledb.VehicleRepo {
	return s.vehicleRepo
}

// SettingsRepo returns the underlying settings repository for simple lookups.
func (s *VehicleService) SettingsRepo() *settingsdb.SettingsRepo {
	return s.settingsRepo
}

// StateRepo returns a vehicleStateProvider that derives current vehicle state
// and transition timestamp from fsm_transitions (000187), without reading the
// dropped vehicle_states snapshot table.
func (s *VehicleService) StateRepo() *vehicleStateProvider {
	return s.stateProvider
}

// vehicleStateProvider derives the current vehicle state and the timestamp at
// which that state began, sourced from fsm_transitions (000187 schema).
//
// It is the lightweight fsm_transitions-backed replacement for the legacy
// *database.VehicleStateRepo.GetCurrentStateSince introduced when the
// vehicle_states snapshot table was dropped. Methods are nil-safe so
// constructor-time tests that build a zero-value VehicleService keep
// compiling.
type vehicleStateProvider struct {
	db *database.DB
}

// GetCurrentStateSince returns the most recent vehicle FSM state for
// vehicleID along with the timestamp at which that state was entered.
// Returns ("", nil, nil) when no row exists or when the provider is unwired
// (for example, in tests that build &VehicleService{} directly).
func (p *vehicleStateProvider) GetCurrentStateSince(ctx context.Context, vehicleID int64) (string, *time.Time, error) {
	if p == nil || p.db == nil || p.db.Pool == nil {
		return "", nil, nil
	}
	var state string
	var since time.Time
	err := p.db.Pool.QueryRow(ctx,
		`SELECT to_state, ts FROM fsm_transitions
		 WHERE vehicle_id = $1 AND fsm_name = 'vehicle'
		 ORDER BY ts DESC LIMIT 1`,
		vehicleID,
	).Scan(&state, &since)
	if err != nil {
		// No-row is not a logical error — caller treats it as "unknown".
		return "", nil, nil
	}
	return state, &since, nil
}

// BuildStateFromSignalStore constructs a VehicleState from the in-memory
// SignalStore, with comprehensive DB fallbacks for every field.
// NEVER returns nil — always builds a complete state from whatever data
// is available (SignalStore → snapshot tables → zero defaults).
func (s *VehicleService) BuildStateFromSignalStore(store *signal.Store, vehicle *vehiclemodel.Vehicle) *vehiclemodel.VehicleState {
	state := &vehiclemodel.VehicleState{
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

	// Read every field from SignalStore.
	//
	// Every numeric extraction below MUST go through signal.Float64Value
	// (or signal.Float64 for nested map members). The codec stores Float5 as
	// float32 and Int3/Int4 as int32; a direct `.(float64)` assertion silently
	// drops those values. See the coerce.go contract.

	if f, ok := signal.Float64Value(all["VehicleSpeed"]); ok {
		state.Speed = f
	}
	if f, ok := signal.Float64Value(all["Odometer"]); ok {
		state.Odometer = f
	}
	if f, ok := signal.Float64Value(all["BatteryLevel"]); ok {
		state.BatteryLevel = int(f)
	}
	if state.BatteryLevel == 0 {
		if f, ok := signal.Float64Value(all["Soc"]); ok {
			state.BatteryLevel = int(f)
		}
	}
	if f, ok := signal.Float64Value(all["IdealBatteryRange"]); ok {
		state.IdealRange = f
	}
	if f, ok := signal.Float64Value(all["RatedRange"]); ok {
		state.RatedRange = f
	}
	if state.RatedRange == 0 {
		if f, ok := signal.Float64Value(all["EstBatteryRange"]); ok {
			state.RatedRange = f
		}
	}
	if f, ok := signal.Float64Value(all["InsideTemp"]); ok {
		state.InsideTemp = f
	}
	if f, ok := signal.Float64Value(all["OutsideTemp"]); ok {
		state.OutsideTemp = f
	}

	// Location: codec emits a composite map[string]any with float32/float64
	// latitude+longitude members. Use signal.Float64 on the unwrapped
	// elements so float32 lat/lon survives the projection.
	if v := all["Location"]; v != nil {
		if loc, ok := v.Raw.(map[string]interface{}); ok {
			if lat, ok := signal.Float64(loc["latitude"]); ok {
				state.Latitude = lat
			}
			if lon, ok := signal.Float64(loc["longitude"]); ok {
				state.Longitude = lon
			}
		}
	}
	if f, ok := signal.Float64Value(all["Latitude"]); ok {
		state.Latitude = f
	}
	if f, ok := signal.Float64Value(all["Longitude"]); ok {
		state.Longitude = f
	}
	if f, ok := signal.Float64Value(all["GpsHeading"]); ok {
		fc := f
		state.Heading = &fc
	}

	// Power (computed or direct)
	if f, ok := signal.Float64Value(all["Power"]); ok {
		state.Power = f
	} else {
		voltage, vok := signal.Float64Value(all["PackVoltage"])
		current, cok := signal.Float64Value(all["PackCurrent"])
		if vok && cok {
			state.Power = voltage * current / 1000.0
		}
	}

	// Charging state
	if v := all["DetailedChargeState"]; v != nil {
		if cs, ok := v.Raw.(string); ok {
			state.IsCharging = enums.IsCharging(cs)
		}
	}
	if !state.IsCharging {
		if f, ok := signal.Float64Value(all["ChargeAmps"]); ok {
			state.IsCharging = f > 1.0
		}
	}
	if f, ok := signal.Float64Value(all["ACChargingPower"]); ok {
		// VehicleState's established JSON contract exposes charger_power in
		// kW; signal.Store is canonical W after telemetry normalization.
		state.ChargerPower = f / 1000.0
	}
	if f, ok := signal.Float64Value(all["DCChargingPower"]); ok && f > 0 {
		state.ChargerPower = f / 1000.0
	}
	if f, ok := signal.Float64Value(all["ChargeRateMilePerHour"]); ok {
		state.ChargeRate = f
	}
	if f, ok := signal.Float64Value(all["TimeToFullCharge"]); ok {
		state.TimeToFullChg = f
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
		default:
			// Numeric HvacPower variants may be float32 or int32; route them
			// through the canonical converter.
			if f, ok := signal.Float64(v.Raw); ok {
				state.IsClimateOn = f > 0
			}
		}
	}

	// Fall back to signal_log for fields the live store left at their Go zero
	// value. signal_log is the durable, ADR-001-blessed last-value-per-signal
	// store; reading from snapshot tables (positions, state_snapshots,
	// battery_snapshots, climate_snapshots, etc.) is forbidden. Live values
	// always win — the fallback only fills holes.
	ctx := context.Background()
	if s.state != nil {
		snap, err := s.state.State(ctx, vehicle.ID, time.Now().UTC())
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("vehicle service: signal_log fallback read failed")
		} else if len(snap) > 0 {
			fillStateFromSnapshot(state, all, snap)
		}
	}

	// Fall back to fsm_transitions for the vehicle state string so handlers
	// that build state from a cold SignalStore still get a non-empty State after
	// a pod restart.
	if state.State == "" && s.stateProvider != nil {
		if currentState, _, err := s.stateProvider.GetCurrentStateSince(ctx, vehicle.ID); err == nil && currentState != "" {
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
// mapping mirrors BuildStateFromSignalStore so the merged state is
// consistent regardless of which layer supplied each value. Live data is
// always preferred — boolean fields are only filled when the live store had
// no entry for the corresponding signal name (avoiding false-vs-unset
// ambiguity).
func fillStateFromSnapshot(state *vehiclemodel.VehicleState, live map[string]*signal.Value, snap signal.State) {
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
// signal.LogStateReader.State returns numbers as float64 (per
// state_reader_log.go assembleState), but we accept int / int64 defensively
// in case the test fake or future readers produce them.
func snapFloat(snap signal.State, key string) (float64, bool) {
	v, ok := snap[key]
	if !ok {
		return 0, false
	}
	return signal.Float64(v)
}

// snapString extracts a string value from a signal_log snapshot map.
func snapString(snap signal.State, key string) (string, bool) {
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
// "true"/"1" are accepted to mirror BuildStateFromSignalStore.
func snapBool(snap signal.State, key string) (bool, bool) {
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
func (s *VehicleService) SyncFromTesla(ctx context.Context, teslaClient *tesla.Client) ([]*vehiclemodel.Vehicle, error) {
	vehicles, err := teslaClient.ListVehicles(ctx)
	if err != nil {
		return nil, err
	}

	var synced []*vehiclemodel.Vehicle
	for _, tv := range vehicles {
		existing, _ := s.vehicleRepo.GetByID(ctx, tv.VehicleID)
		if existing != nil {
			synced = append(synced, existing)
			continue
		}

		v := &vehiclemodel.Vehicle{
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
