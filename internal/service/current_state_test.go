package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ── Test doubles ────────────────────────────────────────────────────────────

// fakeFSMState is the injectable persisted-FSM lookup. It exists because
// telemetry-vs-FSM conflict detection is meaningless without BOTH sides, and
// the production side is an fsm_transitions query.
type fakeFSMState struct {
	state               string
	since               *time.Time
	err                 error
	calls               int
	waitForCancellation bool
}

func (f *fakeFSMState) GetCurrentStateSince(ctx context.Context, _ int64) (string, *time.Time, error) {
	f.calls++
	if f.waitForCancellation {
		<-ctx.Done()
		return "", nil, ctx.Err()
	}
	return f.state, f.since, f.err
}

// failingLiveStore models a live boundary that is DOWN. It must degrade the
// read (durable fallback + unknown freshness), never fail it.
type failingLiveStore struct {
	err   error
	calls int
}

func (f *failingLiveStore) Update(context.Context, int64, map[string]interface{}) error { return nil }
func (f *failingLiveStore) UpdateNonBlocking(context.Context, int64, map[string]interface{}) error {
	return nil
}
func (f *failingLiveStore) GetSignal(context.Context, int64, string, signal.LiveSignalReadPreference) (*signal.Value, error) {
	return nil, f.err
}
func (f *failingLiveStore) GetAll(context.Context, int64, signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	f.calls++
	return nil, f.err
}
func (f *failingLiveStore) Warm(context.Context, int64) error { return nil }
func (f *failingLiveStore) LocalVehicleIDs() []int64          { return nil }

// liveStoreWith builds a local-only hybrid store seeded with real (observed)
// signal values, matching the production L1 path.
func liveStoreWith(t *testing.T, vehicleID int64, observedAt time.Time, values map[string]interface{}) signal.LiveSignalStore {
	t.Helper()
	local := signal.New()
	for name, raw := range values {
		local.Set(vehicleID, name, raw, observedAt)
	}
	store, err := signal.NewHybridLiveSignalStore(local, nil, signal.LiveSignalStoreModeLocal)
	if err != nil {
		t.Fatalf("create live signal store: %v", err)
	}
	return store
}

// ── Resolution contract ─────────────────────────────────────────────────────

func TestResolveCurrentStatePreservesLiveProvenance(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	const vehicleID = int64(7)
	now := time.Now().UTC()
	observedAt := now.Add(-2 * time.Second)
	live := liveStoreWith(t, vehicleID, observedAt, map[string]interface{}{
		"BatteryLevel": 61.0,
	})

	svc := &VehicleService{fsmState: &fakeFSMState{}}
	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}

	if got.State == nil || got.State.BatteryLevel != 61 {
		t.Fatalf("state = %#v, want battery_level 61", got.State)
	}
	if !got.Live {
		t.Fatal("live = false, want true for a hydrated live store")
	}
	if got.DataSource != DataSourceLiveSignalStore {
		t.Fatalf("data_source = %q, want %q", got.DataSource, DataSourceLiveSignalStore)
	}
	if got.Freshness != FreshnessFresh {
		t.Fatalf("freshness = %q, want %q", got.Freshness, FreshnessFresh)
	}
	if got.ObservedAt == nil || !got.ObservedAt.Equal(observedAt) {
		t.Fatalf("observed_at = %v, want %v", got.ObservedAt, observedAt)
	}
	if len(got.VerifiedFields) != 1 || got.VerifiedFields[0] != "battery_level" {
		t.Fatalf("verified_fields = %v, want [battery_level]", got.VerifiedFields)
	}
}

func TestResolveCurrentStateClassifiesOldObservationAsStale(t *testing.T) {
	const vehicleID = int64(8)
	now := time.Now().UTC()
	// Comfortably outside the cross-pod freshness window.
	observedAt := now.Add(-30 * time.Minute)
	live := liveStoreWith(t, vehicleID, observedAt, map[string]interface{}{"BatteryLevel": 44.0})

	svc := &VehicleService{fsmState: &fakeFSMState{}}
	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if got.Freshness != FreshnessStale {
		t.Fatalf("freshness = %q, want %q", got.Freshness, FreshnessStale)
	}
	if got.ObservedAt == nil || !got.ObservedAt.Equal(observedAt) {
		t.Fatalf("observed_at = %v, want the ORIGINAL observation %v", got.ObservedAt, observedAt)
	}
}

func TestResolveCurrentStateDegradesOnLiveReadFailure(t *testing.T) {
	// A live-store outage is a fact about US. It must not fail the read, and
	// it must not be laundered into "fresh" by the durable fallback.
	store := &failingLiveStore{err: errors.New("redis: connection refused")}
	svc := &VehicleService{fsmState: &fakeFSMState{}}

	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: 9}, store, time.Now().UTC())
	if err != nil {
		t.Fatalf("ResolveCurrentState returned an error for a degraded live read: %v", err)
	}
	if store.calls != 1 {
		t.Fatalf("live GetAll calls = %d, want 1", store.calls)
	}
	if got.LiveReadErr == nil {
		t.Fatal("live_read_err = nil, want the degradation recorded")
	}
	if got.Live {
		t.Fatal("live = true after a failed live read")
	}
	if got.DataSource != DataSourceDBFallback {
		t.Fatalf("data_source = %q, want %q", got.DataSource, DataSourceDBFallback)
	}
	if got.Freshness != FreshnessUnknown {
		t.Fatalf("freshness = %q, want %q", got.Freshness, FreshnessUnknown)
	}
	if len(got.VerifiedFields) != 0 {
		t.Fatalf("verified_fields = %v, want empty", got.VerifiedFields)
	}
	if got.State == nil {
		t.Fatal("state = nil; the durable fallback must still answer")
	}
}

func TestResolveCurrentStateWithoutLiveStoreIsDurableOnly(t *testing.T) {
	since := time.Now().UTC().Add(-time.Hour)
	svc := &VehicleService{fsmState: &fakeFSMState{state: enums.StateParked, since: &since}}

	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: 10}, nil, time.Now().UTC())
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if got.Live || got.DataSource != DataSourceDBFallback || got.Freshness != FreshnessUnknown {
		t.Fatalf("got %+v, want a durable-only, unknown-freshness answer", got)
	}
	if got.State == nil || got.State.Since == nil || !got.State.Since.Equal(since) {
		t.Fatalf("since = %v, want %v", got.State.Since, since)
	}
	if got.VerifiedFields == nil {
		t.Fatal("verified_fields = nil, want an empty array on the wire")
	}
}

func TestResolveCurrentStateDeadlineBoundsFSMFallback(t *testing.T) {
	svc := &VehicleService{fsmState: &fakeFSMState{waitForCancellation: true}}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	_, err := svc.ResolveCurrentState(
		ctx,
		&vehiclemodel.Vehicle{ID: 11},
		nil,
		time.Now().UTC(),
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ResolveCurrentState error = %v, want context deadline exceeded", err)
	}
}

func TestResolveCurrentStateRejectsNilVehicle(t *testing.T) {
	svc := &VehicleService{}
	if _, err := svc.ResolveCurrentState(context.Background(), nil, nil, time.Time{}); !errors.Is(err, ErrNilVehicle) {
		t.Fatalf("err = %v, want ErrNilVehicle", err)
	}
}

func TestResolveCurrentStateHonoursCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	svc := &VehicleService{}
	_, err := svc.ResolveCurrentState(ctx, &vehiclemodel.Vehicle{ID: 11}, nil, time.Time{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

// ── Telemetry-vs-FSM conflict contract ──────────────────────────────────────

func TestTelemetryDerivedStatePrecedenceAndTrust(t *testing.T) {
	charging := &vehiclemodel.VehicleState{IsCharging: true, Speed: 40}
	moving := &vehiclemodel.VehicleState{Speed: 40}

	// Charging outranks motion, matching the frontend contract.
	if got, reason := telemetryDerivedState(charging,
		map[string]bool{"is_charging": true, "speed": true}, FreshnessFresh); got != enums.StateCharging || reason != "charging" {
		t.Fatalf("got (%q,%q), want (charging,charging)", got, reason)
	}
	if got, reason := telemetryDerivedState(moving,
		map[string]bool{"speed": true}, FreshnessFresh); got != enums.StateDriving || reason != "motion" {
		t.Fatalf("got (%q,%q), want (driving,motion)", got, reason)
	}
	// Unverified fields make no claim, however tempting the value looks.
	if got, _ := telemetryDerivedState(charging, map[string]bool{}, FreshnessFresh); got != "" {
		t.Fatalf("unverified telemetry claimed %q, want no claim", got)
	}
	// Stale streams make no claim either.
	for _, freshness := range []StateFreshness{FreshnessStale, FreshnessUnknown} {
		if got, _ := telemetryDerivedState(charging,
			map[string]bool{"is_charging": true}, freshness); got != "" {
			t.Fatalf("%s telemetry claimed %q, want no claim", freshness, got)
		}
	}
}

func TestResolveCurrentStateFlagsChargingVsFSMDisagreement(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	const vehicleID = int64(21)
	now := time.Now().UTC()
	live := liveStoreWith(t, vehicleID, now.Add(-time.Second), map[string]interface{}{
		"DetailedChargeState": enums.ChargeStateCharging,
	})
	svc := &VehicleService{fsmState: &fakeFSMState{state: enums.StateParked}}

	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if got.Conflict == nil {
		t.Fatal("conflict = nil; verified charging telemetry vs a parked FSM must be reported")
	}
	if got.Conflict.TelemetryState != enums.StateCharging || got.Conflict.FSMState != enums.StateParked {
		t.Fatalf("conflict = %+v, want charging vs parked", got.Conflict)
	}
	if counts := metrics.VehicleStateConflictSnapshot(); counts["charging->parked"] != 1 {
		t.Fatalf("conflict gauge = %v, want one charging->parked vehicle", counts)
	}

	// Re-reading the same vehicle is what a dashboard poll does. The gauge is
	// a CURRENT count, so it must not grow.
	for i := 0; i < 3; i++ {
		if _, err := svc.ResolveCurrentState(
			context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now); err != nil {
			t.Fatalf("repeat resolve %d: %v", i, err)
		}
	}
	if counts := metrics.VehicleStateConflictSnapshot(); counts["charging->parked"] != 1 {
		t.Fatalf("conflict gauge after repeated reads = %v, want 1", counts)
	}
}

func TestResolveCurrentStateClearsConflictOnConvergence(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	const vehicleID = int64(22)
	now := time.Now().UTC()
	live := liveStoreWith(t, vehicleID, now.Add(-time.Second), map[string]interface{}{
		"DetailedChargeState": enums.ChargeStateCharging,
	})
	fsm := &fakeFSMState{state: enums.StateParked}
	svc := &VehicleService{fsmState: fsm}

	if _, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now); err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}

	// The FSM catches up.
	fsm.state = enums.StateCharging
	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if got.Conflict != nil {
		t.Fatalf("conflict = %+v, want nil once the FSM agrees", got.Conflict)
	}
	if counts := metrics.VehicleStateConflictSnapshot(); counts["charging->parked"] != 0 {
		t.Fatalf("conflict gauge = %v, want 0 after convergence", counts)
	}
}

func TestResolveCurrentStateDoesNotFlagStaleTelemetry(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	const vehicleID = int64(23)
	now := time.Now().UTC()
	live := liveStoreWith(t, vehicleID, now.Add(-2*time.Hour), map[string]interface{}{
		"DetailedChargeState": enums.ChargeStateCharging,
	})
	svc := &VehicleService{fsmState: &fakeFSMState{state: enums.StateParked}}

	got, err := svc.ResolveCurrentState(
		context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, live, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if got.Conflict != nil {
		t.Fatalf("conflict = %+v; a stale reading disagreeing with the FSM is expected, not a defect", got.Conflict)
	}
}

func TestResolveCurrentStateMarksStateVerifiedOnlyWhenFresh(t *testing.T) {
	const vehicleID = int64(24)
	now := time.Now().UTC()

	fresh := liveStoreWith(t, vehicleID, now.Add(-time.Second), map[string]interface{}{"BatteryLevel": 50.0})
	svc := &VehicleService{fsmState: &fakeFSMState{state: enums.StateOnline}}
	got, err := svc.ResolveCurrentState(context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, fresh, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if !contains(got.VerifiedFields, "state") {
		t.Fatalf("verified_fields = %v, want the FSM state verified on a fresh stream", got.VerifiedFields)
	}

	stale := liveStoreWith(t, vehicleID, now.Add(-time.Hour), map[string]interface{}{"BatteryLevel": 50.0})
	got, err = svc.ResolveCurrentState(context.Background(), &vehiclemodel.Vehicle{ID: vehicleID}, stale, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}
	if contains(got.VerifiedFields, "state") {
		t.Fatalf("verified_fields = %v; a stale stream must not verify the FSM state", got.VerifiedFields)
	}
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

func TestSortedVerifiedFieldsIsDeterministicAndNeverNil(t *testing.T) {
	got := SortedVerifiedFields(map[string]bool{"speed": true, "battery_level": true, "odometer": false})
	if len(got) != 2 || got[0] != "battery_level" || got[1] != "speed" {
		t.Fatalf("got %v, want [battery_level speed]", got)
	}
	if SortedVerifiedFields(nil) == nil {
		t.Fatal("SortedVerifiedFields(nil) = nil, want an empty slice for the JSON array contract")
	}
}
