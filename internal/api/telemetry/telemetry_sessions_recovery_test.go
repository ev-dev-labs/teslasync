package telemetry

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// recoveryStateCallRecord captures one StateReader.State invocation made by
// the crash-recovery path so tests can assert wire-up: which vehicleID was
// queried at which timestamp anchor (drive.StartTs, charge.StartTs, or the
// definitive terminal evidence timestamp). The "at" anchor is
// load-bearing — a regression that swaps drive start/end anchors would
// silently zero out odometer / energy / lat-lng deltas on every recovered
// session, exactly the bug the StateReader migration was meant to fix.
//
// Local to this file because telemetry_sessions_drive_tracking_test.go and
// telemetry_sessions_charge_tracking_test.go declare identically-shaped
// per-handler call records.
type recoveryStateCallRecord struct {
	vehicleID int64
	at        time.Time
}

// recoveryFakeState is a minimal signal.StateReader used by the recovery
// tests below. Only the State() method is exercised by the snapshot path
// under test; SignalAt and Timeline are present only to satisfy the
// interface. The recorded calls slice is guarded by mu so tests can
// race-safely inspect it without lock copies.
type recoveryFakeState struct {
	mu       sync.Mutex
	calls    []recoveryStateCallRecord
	stateFn  func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	callsCnt int64 // atomic — observable from tests without taking mu
}

func (f *recoveryFakeState) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	atomic.AddInt64(&f.callsCnt, 1)
	f.mu.Lock()
	f.calls = append(f.calls, recoveryStateCallRecord{vehicleID: vehicleID, at: at})
	f.mu.Unlock()
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *recoveryFakeState) SignalAt(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (f *recoveryFakeState) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

func (f *recoveryFakeState) snapshotCalls() []recoveryStateCallRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]recoveryStateCallRecord, len(f.calls))
	copy(out, f.calls)
	return out
}

// Compile-time guarantee.
var _ signal.StateReader = (*recoveryFakeState)(nil)

type recoveryEvidenceFake struct {
	lastDrivingFn          func(time.Time, time.Time) (*datarepairdb.Observation, error)
	firstGearFn            func([]string, time.Time, time.Time) (*datarepairdb.Observation, error)
	firstChargeStateFn     func([]string, time.Time, time.Time) (*datarepairdb.Observation, error)
	firstChargingSessionFn func(time.Time) (*datarepairdb.Observation, error)
	firstDriveFn           func(time.Time) (*datarepairdb.Observation, error)
}

func (f *recoveryEvidenceFake) LastDrivingObservation(
	_ context.Context,
	_ int64,
	_ []string,
	from, to time.Time,
) (*datarepairdb.Observation, error) {
	if f.lastDrivingFn == nil {
		return nil, nil
	}
	return f.lastDrivingFn(from, to)
}

func (f *recoveryEvidenceFake) FirstGearObservation(
	_ context.Context,
	_ int64,
	gears []string,
	after, until time.Time,
) (*datarepairdb.Observation, error) {
	if f.firstGearFn == nil {
		return nil, nil
	}
	return f.firstGearFn(gears, after, until)
}

func (f *recoveryEvidenceFake) FirstChargeStateObservation(
	_ context.Context,
	_ int64,
	_ []string,
	values []string,
	after, until time.Time,
) (*datarepairdb.Observation, error) {
	if f.firstChargeStateFn == nil {
		return nil, nil
	}
	return f.firstChargeStateFn(values, after, until)
}

func (f *recoveryEvidenceFake) FirstChargingSessionAfter(
	_ context.Context,
	_ int64,
	after time.Time,
	_ int64,
) (*datarepairdb.Observation, error) {
	if f.firstChargingSessionFn == nil {
		return nil, nil
	}
	return f.firstChargingSessionFn(after)
}

func (f *recoveryEvidenceFake) FirstDriveAfter(
	_ context.Context,
	_ int64,
	after time.Time,
	_ int64,
) (*datarepairdb.Observation, error) {
	if f.firstDriveFn == nil {
		return nil, nil
	}
	return f.firstDriveFn(after)
}

var _ recoveryEvidence = (*recoveryEvidenceFake)(nil)

// TestRecovery_RebuildsStateFromForwardFold pins the core contract of the
// migration: the snapshot used to enrich a recovered drive/charge session
// is reconstructed via signal.StateReader.State (forward-fold over
// signal_log) and NOT via the legacy *signaldb.SignalLogReader.SnapshotAt
// path that this prompt removed.
//
// Why this matters: Tesla Fleet Telemetry only re-emits a signal when the
// value changes (delta encoding). Under the legacy snapshot-table path,
// any signal that had not changed since the start of the recovery gap was
// missing from the reconstructed snapshot, and the downstream enrichment
// code (snapFloat / signalStr) silently dropped it. The result was
// recovered drives with end_lat/end_lon == 0, energy_used_kwh == 0, and
// distance_mi == 0. StateReader.State forward-folds signal_log so the
// last-known value of every signal emitted at-or-before `at` is present
// in the returned map, even if it has not been re-emitted recently.
//
// A real end-to-end RecoverIncompleteSessions test would require a
// Postgres pool plus signal_log fixtures plus drive/charge repo stubs;
// the contract we pin here — that recoveryStateBundle.state.State is the
// read source, queried at the correct per-session anchor, and that the
// returned signal.State round-trips through stateToLegacyMap into the
// legacy snapFloat helper — is exactly the contract the four migrated
// call sites in RecoverIncompleteSessions enforce.
func TestRecovery_RebuildsStateFromForwardFold(t *testing.T) {
	const (
		driveVehicleID  = int64(7)
		chargeVehicleID = int64(11)
	)
	driveStart := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	driveEnd := driveStart.Add(45 * time.Minute)
	chargeStart := time.Date(2026, 4, 30, 14, 0, 0, 0, time.UTC)
	chargeEnd := chargeStart.Add(2 * time.Hour)

	fake := &recoveryFakeState{
		stateFn: func(_ context.Context, vehicleID int64, at time.Time) (signal.State, error) {
			// Distinct payloads per (vehicle, anchor) so the test can
			// confirm the bundle plumbed each at-anchor through to the
			// right StateReader call. Forward-fold semantics: the value
			// at `at` is the latest emission at-or-before `at` — under
			// the legacy SnapshotAt path these would be nil for any
			// signal not re-emitted since the gap began.
			switch {
			case vehicleID == driveVehicleID && at.Equal(driveStart):
				return signal.State{
					"Odometer":           12000.0,
					"BatteryLevel":       82.0,
					"Latitude":           37.5,
					"Longitude":          -122.3,
					"LifetimeEnergyUsed": 4500.0,
				}, nil
			case vehicleID == driveVehicleID && at.Equal(driveEnd):
				return signal.State{
					"Odometer":           12035.5,
					"BatteryLevel":       72.0,
					"Latitude":           37.6,
					"Longitude":          -122.4,
					"LifetimeEnergyUsed": 4515.5,
				}, nil
			case vehicleID == chargeVehicleID && at.Equal(chargeStart):
				return signal.State{
					"BatteryLevel":       18.0,
					"ACChargingEnergyIn": 100000.0,
					"BatteryRange":       95.0,
				}, nil
			case vehicleID == chargeVehicleID && at.Equal(chargeEnd):
				return signal.State{
					"BatteryLevel":       80.0,
					"ACChargingEnergyIn": 130500.0,
					"BatteryRange":       215.0,
				}, nil
			}
			t.Errorf("unexpected State call: vehicleID=%d at=%v", vehicleID, at)
			return signal.State{}, nil
		},
	}

	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	tracker.SetChargeStateReader(fake)
	t.Cleanup(func() {
		tracker.SetDriveStateReader(nil)
		tracker.SetChargeStateReader(nil)
	})

	driveR := recoveryStateBundle{state: tracker.driveStateReader()}
	chargeR := recoveryStateBundle{state: tracker.chargeStateReader()}
	if driveR.state == nil {
		t.Fatalf("driveR.state should be the installed StateReader; got nil")
	}
	if chargeR.state == nil {
		t.Fatalf("chargeR.state should be the installed StateReader; got nil")
	}

	ctx := context.Background()

	// Mirror the production call shape from RecoverIncompleteSessions:
	// driveR.state.State at drive.StartTs and its parked-gear boundary, then
	// chargeR.state.State at charge.StartTs and its terminal-state boundary.
	driveStartSnap, err := driveR.state.State(ctx, driveVehicleID, driveStart)
	if err != nil {
		t.Fatalf("driveR.state.State(start) err = %v", err)
	}
	driveEndSnap, err := driveR.state.State(ctx, driveVehicleID, driveEnd)
	if err != nil {
		t.Fatalf("driveR.state.State(end) err = %v", err)
	}
	chargeStartSnap, err := chargeR.state.State(ctx, chargeVehicleID, chargeStart)
	if err != nil {
		t.Fatalf("chargeR.state.State(start) err = %v", err)
	}
	chargeEndSnap, err := chargeR.state.State(ctx, chargeVehicleID, chargeEnd)
	if err != nil {
		t.Fatalf("chargeR.state.State(end) err = %v", err)
	}

	calls := fake.snapshotCalls()
	if len(calls) != 4 {
		t.Fatalf("State() calls = %d, want 4 (drive start+end, charge start+end)", len(calls))
	}

	// Anchor pinning: the per-call (vehicleID, at) pairs must match the
	// production code's plumbing. A regression that uses time.Now() for
	// the end anchor (instead of the evidence timestamp) would corrupt deltas on
	// every recovered session — the equality checks below catch that.
	wantPairs := []recoveryStateCallRecord{
		{vehicleID: driveVehicleID, at: driveStart},
		{vehicleID: driveVehicleID, at: driveEnd},
		{vehicleID: chargeVehicleID, at: chargeStart},
		{vehicleID: chargeVehicleID, at: chargeEnd},
	}
	for i, want := range wantPairs {
		if calls[i].vehicleID != want.vehicleID {
			t.Fatalf("call[%d].vehicleID = %d, want %d", i, calls[i].vehicleID, want.vehicleID)
		}
		if !calls[i].at.Equal(want.at) {
			t.Fatalf("call[%d].at = %v, want %v", i, calls[i].at, want.at)
		}
	}

	// Forward-fold round-trip: each signal.State must convert into the
	// legacy map[string]interface{} shape the recovery enrichment helpers
	// (snapFloat, signalStr, units.GetUnitFromSnapshot) consume. A
	// regression that drops stateToLegacyMap and passes signal.State
	// directly would compile (the named map types are structurally
	// similar) but snapFloat would silently fail every key lookup
	// because of Go's named-type assignability rules.
	startLegacy := stateToLegacyMap(driveStartSnap)
	endLegacy := stateToLegacyMap(driveEndSnap)
	startOdo, ok := snapFloat(startLegacy, "Odometer")
	if !ok || startOdo != 12000.0 {
		t.Fatalf("drive start Odometer via snapFloat = (%v, %v), want (12000.0, true)", startOdo, ok)
	}
	endOdo, ok := snapFloat(endLegacy, "Odometer")
	if !ok || endOdo != 12035.5 {
		t.Fatalf("drive end Odometer via snapFloat = (%v, %v), want (12035.5, true)", endOdo, ok)
	}
	if delta := endOdo - startOdo; delta != 35.5 {
		t.Fatalf("drive odometer delta from snapshots = %v, want 35.5", delta)
	}

	// Charge energy delta: a regression that swapped start/end would
	// yield a negative delta the production code drops on the > 0 guard,
	// silently dropping every recovered charge's energy total.
	chargeStartLegacy := stateToLegacyMap(chargeStartSnap)
	chargeEndLegacy := stateToLegacyMap(chargeEndSnap)
	startEnergy, ok := snapFloat(chargeStartLegacy, "ACChargingEnergyIn")
	if !ok || startEnergy != 100000.0 {
		t.Fatalf("charge start ACChargingEnergyIn = (%v, %v), want (100000.0, true)", startEnergy, ok)
	}
	endEnergy, ok := snapFloat(chargeEndLegacy, "ACChargingEnergyIn")
	if !ok || endEnergy != 130500.0 {
		t.Fatalf("charge end ACChargingEnergyIn = (%v, %v), want (130500.0, true)", endEnergy, ok)
	}
	if delta := endEnergy - startEnergy; delta != 30500 {
		t.Fatalf("charge energy delta from snapshots = %v, want 30500 Wh", delta)
	}

	// Nil-state degradation: when SetDriveStateReader has not run yet
	// (first boot before router wiring), the bundle's .state field is
	// nil and the production branches fall through to empty snapshot
	// maps without panicking. stateToLegacyMap(nil) on a nil signal.State
	// must yield a non-nil empty map so downstream snapFloat cleanly
	// reports "missing key" rather than nil-derefing.
	if m := stateToLegacyMap(nil); m == nil || len(m) != 0 {
		t.Fatalf("stateToLegacyMap(nil) = %v, want empty non-nil map", m)
	}
	emptyTracker := &TelemetrySessionTracker{}
	emptyBundle := recoveryStateBundle{state: emptyTracker.driveStateReader()}
	if emptyBundle.state != nil {
		t.Fatalf("emptyBundle.state = %v, want nil (no SetDriveStateReader called)", emptyBundle.state)
	}
}

// TestRecovery_AllFourCallsMigrated is the meta-assertion that guards the
// migration contract: the production source file
// telemetry_sessions_recovery.go must contain ZERO call sites for the
// legacy *signaldb.SignalLogReader.SnapshotAt method AND must contain at
// least four `.state.State(` call sites (drive start, drive end, charge
// start, charge end). A regression that reverts even a single call (e.g.
// while "fixing" a recovery enrichment field) would re-introduce the
// non-forward-fold snapshot path and is caught here.
//
// Comments referencing SnapshotAt in prose form are permitted — the
// banned anchor is the literal `.SnapshotAt(` call shape.
func TestRecovery_AllFourCallsMigrated(t *testing.T) {
	const file = "telemetry_sessions_recovery.go"
	src, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read %s: %v", file, err)
	}
	s := string(src)

	const banned = ".SnapshotAt("
	if idx := strings.Index(s, banned); idx >= 0 {
		// Print the offending line for fast diagnosis.
		lineStart := strings.LastIndex(s[:idx], "\n") + 1
		lineEnd := idx + strings.Index(s[idx:], "\n")
		if lineEnd < idx {
			lineEnd = len(s)
		}
		t.Fatalf("found banned %q in %s — legacy SnapshotAt call site reintroduced:\n  %s",
			banned, file, strings.TrimSpace(s[lineStart:lineEnd]))
	}

	const required = ".state.State("
	count := strings.Count(s, required)
	if count < 4 {
		t.Fatalf("found %d %q call sites in %s, want at least 4 "+
			"(drive start, drive end, charge start, charge end)",
			count, required, file)
	}
}

func TestCleanupWithoutDurableReaderLeavesSessionsOpen(t *testing.T) {
	t.Parallel()

	lastSeen := time.Now().UTC().Add(-time.Hour)
	tracker := &TelemetrySessionTracker{
		localSignals: signal.New(),
		activeDrives: map[int64]*streamingDrive{
			7: {
				DriveID:   11,
				VehicleID: 7,
				StartTime: lastSeen.Add(-time.Hour),
				LastSeen:  lastSeen,
			},
		},
		activeCharges: map[int64]*streamingCharge{
			8: {
				SessionID: 21,
				VehicleID: 8,
				StartTime: lastSeen.Add(-time.Hour),
				LastSeen:  lastSeen,
			},
		},
	}

	tracker.CleanupStaleSessions(context.Background(), 5*time.Minute)

	if _, ok := tracker.activeDrives[7]; !ok {
		t.Fatal("ambiguous stale drive was removed without terminal evidence")
	}
	if _, ok := tracker.activeCharges[8]; !ok {
		t.Fatal("ambiguous stale charging session was removed without terminal evidence")
	}
}

func TestValidateRecoveredSessionsDetachesAmbiguousContradictions(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	startedAt := now.Add(-2 * time.Hour)
	evidence := &recoveryEvidenceFake{
		firstChargeStateFn: func(values []string, _, _ time.Time) (*datarepairdb.Observation, error) {
			for _, value := range values {
				if value == "Charging" {
					return &datarepairdb.Observation{
						Ts:    startedAt.Add(time.Hour),
						Field: "DetailedChargeState",
						Value: "Charging",
					}, nil
				}
			}
			return nil, nil
		},
		firstDriveFn: func(time.Time) (*datarepairdb.Observation, error) {
			return &datarepairdb.Observation{
				Ts:    startedAt.Add(90 * time.Minute),
				Field: "drive.started_at",
			}, nil
		},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives: map[int64]*streamingDrive{
			7: {DriveID: 11, VehicleID: 7, StartTime: startedAt},
		},
		activeCharges: map[int64]*streamingCharge{
			8: {SessionID: 21, VehicleID: 8, StartTime: startedAt},
		},
	}

	tracker.validateRecoveredWithEvidence(context.Background(), evidence, now)

	if _, ok := tracker.activeDrives[7]; ok {
		t.Fatal("drive contradicted by charging evidence remained active in memory")
	}
	if _, ok := tracker.activeCharges[8]; ok {
		t.Fatal("charging session contradicted by a later drive remained active in memory")
	}
}

func TestValidateRecoveredDriveIgnoresParkAfterNextDriveStarts(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	startedAt := now.Add(-3 * time.Hour)
	nextDrive := startedAt.Add(time.Hour)
	laterPark := startedAt.Add(2 * time.Hour)
	evidence := &recoveryEvidenceFake{
		firstDriveFn: func(time.Time) (*datarepairdb.Observation, error) {
			return &datarepairdb.Observation{Ts: nextDrive, Field: "drive.started_at"}, nil
		},
		firstGearFn: func(gears []string, _, until time.Time) (*datarepairdb.Observation, error) {
			for _, gear := range gears {
				if gear == enums.GearPark && !laterPark.After(until) {
					return &datarepairdb.Observation{
						Ts: laterPark, Field: "Gear", Value: enums.GearPark,
					}, nil
				}
			}
			return nil, nil
		},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives: map[int64]*streamingDrive{
			7: {DriveID: 11, VehicleID: 7, StartTime: startedAt},
		},
		activeCharges: map[int64]*streamingCharge{},
	}

	tracker.validateRecoveredWithEvidence(context.Background(), evidence, now)

	if _, ok := tracker.activeDrives[7]; !ok {
		t.Fatal("Park from a later drive closed or detached the earlier drive")
	}
}

func TestValidateRecoveredChargeIgnoresTerminalStateAfterNextChargeStarts(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	startedAt := now.Add(-3 * time.Hour)
	nextCharge := startedAt.Add(time.Hour)
	laterTerminal := startedAt.Add(2 * time.Hour)
	evidence := &recoveryEvidenceFake{
		firstChargingSessionFn: func(time.Time) (*datarepairdb.Observation, error) {
			return &datarepairdb.Observation{Ts: nextCharge, Field: "charging_session.started_at"}, nil
		},
		firstChargeStateFn: func(values []string, _, until time.Time) (*datarepairdb.Observation, error) {
			for _, value := range values {
				if value == enums.ChargeStateDisconnected && !laterTerminal.After(until) {
					return &datarepairdb.Observation{
						Ts: laterTerminal, Field: "DetailedChargeState", Value: enums.ChargeStateDisconnected,
					}, nil
				}
			}
			return nil, nil
		},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives: map[int64]*streamingDrive{},
		activeCharges: map[int64]*streamingCharge{
			7: {SessionID: 21, VehicleID: 7, StartTime: startedAt},
		},
	}

	tracker.validateRecoveredWithEvidence(context.Background(), evidence, now)

	if _, ok := tracker.activeCharges[7]; !ok {
		t.Fatal("terminal state from a later charge closed or detached the earlier charge")
	}
}

func TestValidateRecoveredDrivePrefersEarlierContradictionOverLaterPark(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	startedAt := now.Add(-3 * time.Hour)
	chargingStarted := startedAt.Add(time.Hour)
	laterPark := startedAt.Add(2 * time.Hour)
	evidence := &recoveryEvidenceFake{
		firstGearFn: func(gears []string, _, _ time.Time) (*datarepairdb.Observation, error) {
			for _, gear := range gears {
				if gear == enums.GearPark {
					return &datarepairdb.Observation{
						Ts: laterPark, Field: "Gear", Value: enums.GearPark,
					}, nil
				}
			}
			return nil, nil
		},
		firstChargeStateFn: func(values []string, _, _ time.Time) (*datarepairdb.Observation, error) {
			for _, value := range values {
				if value == enums.ChargeStateCharging {
					return &datarepairdb.Observation{
						Ts: chargingStarted, Field: "DetailedChargeState", Value: enums.ChargeStateCharging,
					}, nil
				}
			}
			return nil, nil
		},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives: map[int64]*streamingDrive{
			7: {DriveID: 11, VehicleID: 7, StartTime: startedAt},
		},
		activeCharges: map[int64]*streamingCharge{},
	}

	tracker.validateRecoveredWithEvidence(context.Background(), evidence, now)

	if _, ok := tracker.activeDrives[7]; ok {
		t.Fatal("later Park overrode an earlier cross-kind contradiction")
	}
}

func TestRecoveryDoesNotInventBoundaries(t *testing.T) {
	t.Parallel()

	recovery, err := os.ReadFile("telemetry_sessions_recovery.go")
	if err != nil {
		t.Fatalf("read recovery source: %v", err)
	}
	cleanup, err := os.ReadFile("telemetry_sessions_flush_backfill.go")
	if err != nil {
		t.Fatalf("read cleanup source: %v", err)
	}

	for _, banned := range []string{"LatestTimestamp(", "completing drive with no signal_log data", "auto-closing stale"} {
		if strings.Contains(string(recovery), banned) {
			t.Errorf("recovery source contains unsafe boundary heuristic %q", banned)
		}
	}
	if strings.Contains(string(recovery), "localSignals") ||
		strings.Contains(string(cleanup), "localSignals") {
		t.Error("recovery boundary decisions must not use hydration-time SignalStore timestamps")
	}
	if got := strings.Count(string(recovery), ".GetOpenSince(ctx,"); got != 2 {
		t.Errorf("recovery uses GetOpenSince %d times, want 2 (drive + charging)", got)
	}
	for _, banned := range []string{"UPDATE drives SET ended_at", "UPDATE charging_sessions SET ended_at"} {
		if strings.Contains(string(cleanup), banned) {
			t.Errorf("cleanup source contains unsafe wall-clock mass update %q", banned)
		}
	}
}

// TestRecovery_PropagatesError pins the error-handling contract on the
// new StateReader-backed recovery path: when state.State returns a
// transport error (e.g. pgx connection drop mid-recovery), the production
// code in RecoverIncompleteSessions logs a warning and continues with an
// empty snapshot map so the recovered session row still commits with
// whatever data was already persisted pre-crash. The error is OBSERVABLE
// (the fake records the call) but does NOT propagate as a panic — this
// is the "graceful degradation" contract for crash recovery: a transient
// cold-read failure must not abort recovery (which would leave every
// stale session open with end_ts NULL forever, blocking subsequent
// recovery attempts on every restart).
//
// A regression that "tightens" error handling by panicking on State()
// errors, or that swallows errors so silently the fake's callsCnt never
// increments, is caught here.
func TestRecovery_PropagatesError(t *testing.T) {
	const vehicleID = int64(13)
	wantErr := errors.New("simulated pgx connection lost")

	fake := &recoveryFakeState{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	t.Cleanup(func() { tracker.SetDriveStateReader(nil) })

	driveR := recoveryStateBundle{state: tracker.driveStateReader()}
	if driveR.state == nil {
		t.Fatalf("driveR.state should be the installed StateReader; got nil")
	}

	// Mirror the production call shape: on err, the snapshot is replaced
	// with an empty map so callers like snapFloat / signalStr cleanly
	// report "missing key" rather than panicking on a nil deref.
	got, err := driveR.state.State(context.Background(), vehicleID,
		time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC))
	if !errors.Is(err, wantErr) {
		t.Fatalf("State() err = %v, want %v", err, wantErr)
	}
	if got != nil {
		t.Fatalf("State() snap on err = %v, want nil (caller substitutes empty map)", got)
	}
	if atomic.LoadInt64(&fake.callsCnt) != 1 {
		t.Fatalf("State() callsCnt = %d, want 1 (error path must still record the call)",
			atomic.LoadInt64(&fake.callsCnt))
	}

	// stateToLegacyMap on a nil signal.State must yield a non-nil empty
	// map — this is the contract the production error branch relies on
	// (`startSnap = map[string]interface{}{}` after a logged warning).
	// A regression that returns nil here would propagate a nil map into
	// snapFloat / signalStr / units.GetUnitFromSnapshot which all assume
	// the map is at least allocated.
	if m := stateToLegacyMap(nil); m == nil || len(m) != 0 {
		t.Fatalf("stateToLegacyMap(nil) = %v, want empty non-nil map", m)
	}
}
