package service

import (
	"context"
	"fmt"
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
	// fsmState overrides the persisted FSM "current state + since" lookup.
	// Nil in production (stateProvider is used); the seam exists so the
	// telemetry-vs-FSM conflict contract in current_state.go is testable
	// without a live fsm_transitions table.
	fsmState fsmStateSource
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
	state, _ := s.BuildStateFromSignalStoreContext(context.Background(), store, vehicle)
	return state
}

// BuildStateFromSignalStoreContext is the cancellation-aware production path.
// Callers with a request context must use it so signal_log and FSM fallback
// reads cannot outlive the request.
func (s *VehicleService) BuildStateFromSignalStoreContext(
	ctx context.Context,
	store *signal.Store,
	vehicle *vehiclemodel.Vehicle,
) (*vehiclemodel.VehicleState, error) {
	state, _, err := s.BuildStateFromSignalStoreWithProvenanceContext(ctx, store, vehicle)
	return state, err
}

// BuildStateFromSignalStoreWithProvenance assembles the same state while
// returning the JSON fields whose exact winning values came from real,
// timestamped live signals. Fields filled from signal_log or synthetic cache
// warmup values remain available in State but are deliberately unverified.
func (s *VehicleService) BuildStateFromSignalStoreWithProvenance(
	store *signal.Store,
	vehicle *vehiclemodel.Vehicle,
) (*vehiclemodel.VehicleState, map[string]bool) {
	state, verified, _ := s.BuildStateFromSignalStoreWithProvenanceContext(
		context.Background(),
		store,
		vehicle,
	)
	return state, verified
}

// BuildStateFromSignalStoreWithProvenanceContext is the cancellation-aware
// provenance assembler used by live HTTP state reads.
func (s *VehicleService) BuildStateFromSignalStoreWithProvenanceContext(
	ctx context.Context,
	store *signal.Store,
	vehicle *vehiclemodel.Vehicle,
) (*vehiclemodel.VehicleState, map[string]bool, error) {
	return s.buildStateFromSignalStoreWithProvenance(ctx, store, vehicle, nil)
}

// buildStateFromSignalStoreWithProvenance is the assembler both the
// single-vehicle and the fleet-batch paths share. `pre` supplies the durable
// signal_log and FSM fallbacks when they were read in bulk for a whole batch;
// a nil prefetch reads them per vehicle exactly as before.
func (s *VehicleService) buildStateFromSignalStoreWithProvenance(
	ctx context.Context,
	store *signal.Store,
	vehicle *vehiclemodel.Vehicle,
	pre *CurrentStatePrefetch,
) (*vehiclemodel.VehicleState, map[string]bool, error) {
	state := &vehiclemodel.VehicleState{
		VehicleID: vehicle.ID,
	}
	verified := make(map[string]bool)
	selected := make(map[string]bool)
	mark := func(field string, value *signal.Value) {
		// Tesla telemetry is a sparse change feed: a field's older observed
		// timestamp remains its current value while any recent real signal
		// establishes stream freshness. This marker records source provenance;
		// the API/frontend apply stream freshness separately.
		selected[field] = true
		if isObservedSignalValue(value) {
			verified[field] = true
		} else {
			delete(verified, field)
		}
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
		mark("speed", all["VehicleSpeed"])
	}
	if f, ok := signal.Float64Value(all["Odometer"]); ok {
		state.Odometer = f
		mark("odometer", all["Odometer"])
	}
	if f, ok := signal.Float64Value(all["BatteryLevel"]); ok {
		state.BatteryLevel = int(f)
		mark("battery_level", all["BatteryLevel"])
	} else {
		if f, ok := signal.Float64Value(all["Soc"]); ok {
			state.BatteryLevel = int(f)
			mark("battery_level", all["Soc"])
		}
	}
	if f, ok := signal.Float64Value(all["IdealBatteryRange"]); ok {
		state.IdealRange = f
		mark("ideal_range", all["IdealBatteryRange"])
	}
	if f, ok := signal.Float64Value(all["RatedRange"]); ok {
		state.RatedRange = f
		mark("rated_range", all["RatedRange"])
	} else {
		if f, ok := signal.Float64Value(all["EstBatteryRange"]); ok {
			state.RatedRange = f
			mark("rated_range", all["EstBatteryRange"])
		}
	}
	if f, ok := signal.Float64Value(all["InsideTemp"]); ok {
		state.InsideTemp = f
		mark("inside_temp", all["InsideTemp"])
	}
	if f, ok := signal.Float64Value(all["OutsideTemp"]); ok {
		state.OutsideTemp = f
		mark("outside_temp", all["OutsideTemp"])
	}

	// The canonical codec flattens Location into LocationLatitude and
	// LocationLongitude. Bare and compound names remain read-only fallbacks for
	// legacy REST/cache values written before the flattening contract.
	if f, ok := signal.Float64Value(all["LocationLatitude"]); ok {
		state.Latitude = f
		mark("latitude", all["LocationLatitude"])
	} else if f, ok := signal.Float64Value(all["Latitude"]); ok {
		state.Latitude = f
		mark("latitude", all["Latitude"])
	} else if v := all["Location"]; v != nil {
		if loc, ok := v.Raw.(map[string]interface{}); ok {
			if lat, ok := signal.Float64(loc["latitude"]); ok {
				state.Latitude = lat
				mark("latitude", v)
			}
		}
	}
	if f, ok := signal.Float64Value(all["LocationLongitude"]); ok {
		state.Longitude = f
		mark("longitude", all["LocationLongitude"])
	} else if f, ok := signal.Float64Value(all["Longitude"]); ok {
		state.Longitude = f
		mark("longitude", all["Longitude"])
	} else if v := all["Location"]; v != nil {
		if loc, ok := v.Raw.(map[string]interface{}); ok {
			if lon, ok := signal.Float64(loc["longitude"]); ok {
				state.Longitude = lon
				mark("longitude", v)
			}
		}
	}
	if f, ok := signal.Float64Value(all["GpsHeading"]); ok {
		fc := f
		state.Heading = &fc
		mark("heading", all["GpsHeading"])
	}

	// Power (computed or direct)
	if f, ok := signal.Float64Value(all["Power"]); ok {
		state.Power = f
		mark("power", all["Power"])
	} else {
		voltage, vok := signal.Float64Value(all["PackVoltage"])
		current, cok := signal.Float64Value(all["PackCurrent"])
		if vok && cok {
			state.Power = voltage * current / 1000.0
			selected["power"] = true
			if isObservedSignalValue(all["PackVoltage"]) &&
				isObservedSignalValue(all["PackCurrent"]) {
				verified["power"] = true
			}
		}
	}

	// Charging state
	if v := all["DetailedChargeState"]; v != nil {
		if cs, ok := v.Raw.(string); ok {
			state.IsCharging = enums.IsCharging(cs)
			mark("is_charging", v)
		}
	}
	if !selected["is_charging"] {
		if f, ok := signal.Float64Value(all["ChargeAmps"]); ok {
			state.IsCharging = f > 1.0
			mark("is_charging", all["ChargeAmps"])
		}
	}
	if f, ok := signal.Float64Value(all["ACChargingPower"]); ok {
		// VehicleState's established JSON contract exposes charger_power in
		// kW; signal.Store is canonical W after telemetry normalization.
		state.ChargerPower = f / 1000.0
		mark("charger_power", all["ACChargingPower"])
	}
	if f, ok := signal.Float64Value(all["DCChargingPower"]); ok && f > 0 {
		state.ChargerPower = f / 1000.0
		mark("charger_power", all["DCChargingPower"])
	}
	if f, ok := signal.Float64Value(all["ChargeRateMilePerHour"]); ok {
		state.ChargeRate = f
		mark("charge_rate", all["ChargeRateMilePerHour"])
	}
	if f, ok := signal.Float64Value(all["TimeToFullCharge"]); ok {
		state.TimeToFullChg = f
		mark("time_to_full_charge", all["TimeToFullCharge"])
	}

	// Security
	if v := all["Locked"]; v != nil {
		switch lv := v.Raw.(type) {
		case bool:
			state.IsLocked = lv
			mark("is_locked", v)
		case string:
			state.IsLocked = lv == "true" || lv == "1"
			mark("is_locked", v)
		}
	}
	if v := all["SentryMode"]; v != nil {
		state.SentryMode = enums.ParseEnumBool(v.Raw)
		mark("sentry_mode", v)
	}

	// Software version
	if v := all["Version"]; v != nil {
		if sv, ok := v.Raw.(string); ok && sv != "" {
			state.SoftwareVersion = sv
			mark("software_version", v)
		}
	}
	if state.SoftwareVersion == "" {
		if v := all["SoftwareUpdateVersion"]; v != nil {
			if sv, ok := v.Raw.(string); ok && sv != "" {
				state.SoftwareVersion = sv
				mark("software_version", v)
			}
		}
	}

	// Climate
	if v := all["HvacPower"]; v != nil {
		switch hv := v.Raw.(type) {
		case bool:
			state.IsClimateOn = hv
			mark("is_climate_on", v)
		case string:
			state.IsClimateOn = enums.ParseHvacPower(hv)
			mark("is_climate_on", v)
		default:
			// Numeric HvacPower variants may be float32 or int32; route them
			// through the canonical converter.
			if f, ok := signal.Float64(v.Raw); ok {
				state.IsClimateOn = f > 0
				mark("is_climate_on", v)
			}
		}
	}

	// Fall back to signal_log for fields the live store left at their Go zero
	// value. signal_log is the durable, ADR-001-blessed last-value-per-signal
	// store; reading from snapshot tables (positions, state_snapshots,
	// battery_snapshots, climate_snapshots, etc.) is forbidden. Live values
	// always win — the fallback only fills holes.
	//
	// In a fleet batch the snapshot arrives from ONE set-based signal_log
	// query taken for the whole page (see CurrentStatePrefetch); the read is
	// the same read, just not repeated per vehicle.
	if snap, err, attempted := s.durableSnapshot(ctx, vehicle.ID, pre); attempted {
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return state, verified, fmt.Errorf("read signal_log fallback for vehicle %d: %w", vehicle.ID, ctxErr)
			}
			log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("vehicle service: signal_log fallback read failed")
		} else if len(snap) > 0 {
			fillStateFromSnapshot(state, snap, selected, verified)
		}
	}

	// Fall back to fsm_transitions for the vehicle state string so handlers
	// that build state from a cold SignalStore still get a non-empty State after
	// a pod restart.
	if state.State == "" {
		if currentState, err := s.fallbackFSMState(ctx, vehicle.ID, pre); err == nil && currentState != "" {
			state.State = currentState
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return state, verified, fmt.Errorf("read FSM fallback for vehicle %d: %w", vehicle.ID, ctxErr)
		}
	}
	if state.State == "" {
		state.State = enums.StateOnline
	}

	return state, verified, nil
}

// fillStateFromSnapshot backfills VehicleState fields that are still at their
// Go zero value from the signal_log snapshot map. The signal-name → field
// mapping mirrors BuildStateFromSignalStore so the merged state is
// consistent regardless of which layer supplied each value. Live data is
// always preferred — boolean fields are only filled when the live store had
// no entry for the corresponding signal name (avoiding false-vs-unset
// ambiguity).
func fillStateFromSnapshot(
	state *vehiclemodel.VehicleState,
	snap signal.State,
	selected map[string]bool,
	verified map[string]bool,
) {
	if !selected["odometer"] {
		if f, ok := snapFloat(snap, "Odometer"); ok {
			state.Odometer = f
			delete(verified, "odometer")
		}
	}
	if !selected["inside_temp"] {
		if f, ok := snapFloat(snap, "InsideTemp"); ok {
			state.InsideTemp = f
			delete(verified, "inside_temp")
		}
	}
	if !selected["outside_temp"] {
		if f, ok := snapFloat(snap, "OutsideTemp"); ok {
			state.OutsideTemp = f
			delete(verified, "outside_temp")
		}
	}
	if !selected["software_version"] {
		if v, ok := snapString(snap, "Version"); ok && v != "" {
			state.SoftwareVersion = v
			delete(verified, "software_version")
		} else if v, ok := snapString(snap, "SoftwareUpdateVersion"); ok && v != "" {
			state.SoftwareVersion = v
			delete(verified, "software_version")
		}
	}
	if !selected["ideal_range"] {
		if f, ok := snapFloat(snap, "IdealBatteryRange"); ok {
			state.IdealRange = f
			delete(verified, "ideal_range")
		}
	}
	if !selected["rated_range"] {
		if f, ok := snapFloat(snap, "RatedRange"); ok {
			state.RatedRange = f
			delete(verified, "rated_range")
		} else if f, ok := snapFloat(snap, "EstBatteryRange"); ok {
			state.RatedRange = f
			delete(verified, "rated_range")
		}
	}
	if !selected["latitude"] {
		if f, ok := snapFloat(snap, "LocationLatitude"); ok {
			state.Latitude = f
			delete(verified, "latitude")
		} else if f, ok := snapFloat(snap, "Latitude"); ok {
			state.Latitude = f
			delete(verified, "latitude")
		}
	}
	if !selected["longitude"] {
		if f, ok := snapFloat(snap, "LocationLongitude"); ok {
			state.Longitude = f
			delete(verified, "longitude")
		} else if f, ok := snapFloat(snap, "Longitude"); ok {
			state.Longitude = f
			delete(verified, "longitude")
		}
	}
	if !selected["battery_level"] {
		if f, ok := snapFloat(snap, "BatteryLevel"); ok {
			state.BatteryLevel = int(f)
			delete(verified, "battery_level")
		} else if f, ok := snapFloat(snap, "Soc"); ok {
			state.BatteryLevel = int(f)
			delete(verified, "battery_level")
		}
	}
	if !selected["speed"] {
		if f, ok := snapFloat(snap, "VehicleSpeed"); ok {
			state.Speed = f
			delete(verified, "speed")
		}
	}

	// Boolean fields use the same explicit-selection guard so a real false is
	// never confused with an unset field.
	if !selected["is_locked"] {
		if b, ok := snapBool(snap, "Locked"); ok {
			state.IsLocked = b
			delete(verified, "is_locked")
		}
	}
	if !selected["sentry_mode"] {
		if v, ok := snap["SentryMode"]; ok {
			state.SentryMode = enums.ParseEnumBool(v)
			delete(verified, "sentry_mode")
		}
	}
	if !selected["is_climate_on"] {
		if v, ok := snap["HvacPower"]; ok {
			switch hv := v.(type) {
			case bool:
				state.IsClimateOn = hv
				delete(verified, "is_climate_on")
			case string:
				state.IsClimateOn = enums.ParseHvacPower(hv)
				delete(verified, "is_climate_on")
			case float64:
				state.IsClimateOn = hv > 0
				delete(verified, "is_climate_on")
			}
		}
	}
}

func isObservedSignalValue(value *signal.Value) bool {
	return value != nil &&
		value.Raw != nil &&
		!value.Timestamp.IsZero() &&
		!value.TimestampSynthetic
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
