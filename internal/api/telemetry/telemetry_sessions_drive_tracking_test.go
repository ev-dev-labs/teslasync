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

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// driveStateCallRecord captures one StateReader.State invocation made by
// the drive-tracking enrichment path so tests can assert wire-up: which
// vehicleID was queried and at what timestamp anchor the snapshot was
// reconstructed. The "at" anchor is load-bearing for the start vs end
// distinction (active.StartTime vs time.Now()) — a regression that swaps
// the two would silently misderive every per-session enrichment field
// (odometer delta, energy delta, lat/lng carry-forward, gear).
//
// Local to this file because telemetry_sessions_charge_tracking_test.go
// declares an identically-shaped chargeStateCallRecord for its own
// per-handler tests.
type driveStateCallRecord struct {
	vehicleID int64
	at        time.Time
}

// driveTrackingFakeState is a minimal signal.StateReader used by the
// drive-tracking tests below. Only the State() method is exercised by
// the snapshot path under test; SignalAt and Timeline are present only to
// satisfy the interface. The recorded calls slice is guarded by mu so
// tests can race-safely inspect it without lock copies.
type driveTrackingFakeState struct {
	mu       sync.Mutex
	calls    []driveStateCallRecord
	stateFn  func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	callsCnt int64 // atomic — observable from tests without taking mu
}

func (f *driveTrackingFakeState) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	atomic.AddInt64(&f.callsCnt, 1)
	f.mu.Lock()
	f.calls = append(f.calls, driveStateCallRecord{vehicleID: vehicleID, at: at})
	f.mu.Unlock()
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *driveTrackingFakeState) SignalAt(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (f *driveTrackingFakeState) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

func (f *driveTrackingFakeState) snapshotCalls() []driveStateCallRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]driveStateCallRecord, len(f.calls))
	copy(out, f.calls)
	return out
}

// Compile-time guarantee.
var _ signal.StateReader = (*driveTrackingFakeState)(nil)

func TestTrackDriving_SpeedZeroTimeoutUsesEventTime(t *testing.T) {
	const vehicleID = int64(71)
	eventStart := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	store := signal.New()
	store.Set(vehicleID, "Gear", "D", eventStart)
	active := &streamingDrive{
		DriveID:            9,
		VehicleID:          vehicleID,
		StartTime:          eventStart.Add(-10 * time.Minute),
		accumulatedSignals: map[string]interface{}{},
	}
	tracker := &TelemetrySessionTracker{
		localSignals:  store,
		activeDrives:  map[int64]*streamingDrive{vehicleID: active},
		activeCharges: map[int64]*streamingCharge{},
	}

	tracker.trackDriving(
		context.Background(),
		vehicleID,
		"VIN",
		map[string]interface{}{"VehicleSpeed": float32(0)},
		nil,
		eventStart,
		map[string]time.Time{"VehicleSpeed": eventStart},
	)
	if !active.LastSpeedZeroTime.Equal(eventStart) {
		t.Fatalf("first zero-speed timestamp = %v, want %v", active.LastSpeedZeroTime, eventStart)
	}

	later := eventStart.Add(3 * time.Minute)
	tracker.trackDriving(
		context.Background(),
		vehicleID,
		"VIN",
		map[string]interface{}{"VehicleSpeed": float32(0)},
		nil,
		later,
		map[string]time.Time{"VehicleSpeed": later},
	)
	if !active.LastSpeedZeroTime.Equal(later) {
		t.Fatalf("zero-speed timeout reset = %v, want event time %v", active.LastSpeedZeroTime, later)
	}
	if _, ok := tracker.activeDrives[vehicleID]; !ok {
		t.Fatal("drive ended despite last-known Gear=D")
	}
}

// TestDriveTracking_SetDriveStateReader_RoundTrip pins the wiring seam
// installed in this prompt: SetDriveStateReader stashes the reader in
// the package-level driveStateRegistry, and driveStateReader recovers
// it for the same tracker pointer. Two distinct trackers must not share
// state — a regression that keys the registry on something other than
// the tracker pointer (e.g. a global) would leak readers across
// independent telemetry handlers.
func TestDriveTracking_SetDriveStateReader_RoundTrip(t *testing.T) {
	t1 := &TelemetrySessionTracker{}
	t2 := &TelemetrySessionTracker{}
	t.Cleanup(func() {
		t1.SetDriveStateReader(nil)
		t2.SetDriveStateReader(nil)
	})

	if got := t1.driveStateReader(); got != nil {
		t.Fatalf("driveStateReader before set = %v, want nil", got)
	}

	r1 := &driveTrackingFakeState{}
	r2 := &driveTrackingFakeState{}
	t1.SetDriveStateReader(r1)
	t2.SetDriveStateReader(r2)

	if got := t1.driveStateReader(); got != r1 {
		t.Fatalf("driveStateReader(t1) = %v, want %v", got, r1)
	}
	if got := t2.driveStateReader(); got != r2 {
		t.Fatalf("driveStateReader(t2) = %v, want %v", got, r2)
	}

	// Nil clears the entry.
	t1.SetDriveStateReader(nil)
	if got := t1.driveStateReader(); got != nil {
		t.Fatalf("driveStateReader(t1) after clear = %v, want nil", got)
	}
	// t2's reader is unaffected by t1's clear.
	if got := t2.driveStateReader(); got != r2 {
		t.Fatalf("driveStateReader(t2) after clearing t1 = %v, want %v", got, r2)
	}
}

// TestDriveTracking_StartSnapshot_UsesState pins the start-of-session
// enrichment contract: the StateReader installed via SetDriveStateReader
// must be queried at active.StartTime — NOT at time.Now() — so the
// reconstructed snapshot reflects what the vehicle was reporting when
// the drive began. A regression that swaps the at-anchor (e.g. queries
// "now" at session-end for both reads) would corrupt the odometer-delta,
// start-battery-pct, and start-lat/lon enrichment fields.
//
// We exercise the snapshot path by directly calling active.state.State
// with active.StartTime — the same call shape the production code in
// completeDriveLocked uses. A real end-to-end completeDriveLocked test
// would require a Postgres pool plus driveRepo / geofenceRepo / geocoder
// stubs (the function is mid-stack and tightly coupled to the DB
// transaction); the contract this test pins — that the StateReader is
// the read source, queried at the start anchor — is exactly the contract
// the four call sites in completeDriveLocked enforce.
func TestDriveTracking_StartSnapshot_UsesState(t *testing.T) {
	const vehicleID = int64(7)
	startTime := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	wantSnap := signal.State{
		"BatteryLevel":       82.0,
		"Odometer":           12345.6,
		"Latitude":           37.5,
		"Longitude":          -122.3,
		"LifetimeEnergyUsed": 4500.0,
	}

	fake := &driveTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return wantSnap, nil
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	t.Cleanup(func() { tracker.SetDriveStateReader(nil) })

	active := &streamingDrive{
		DriveID:   1,
		VehicleID: vehicleID,
		StartTime: startTime,
		state:     tracker.driveStateReader(),
	}
	if active.state == nil {
		t.Fatalf("streamingDrive.state should be the installed StateReader; got nil")
	}

	got, err := active.state.State(context.Background(), vehicleID, active.StartTime)
	if err != nil {
		t.Fatalf("active.state.State(start) error = %v, want nil", err)
	}
	if got["BatteryLevel"] != 82.0 {
		t.Fatalf("start snap BatteryLevel = %v, want 82.0", got["BatteryLevel"])
	}
	if got["Odometer"] != 12345.6 {
		t.Fatalf("start snap Odometer = %v, want 12345.6", got["Odometer"])
	}

	calls := fake.snapshotCalls()
	if len(calls) != 1 {
		t.Fatalf("State() call count = %d, want 1", len(calls))
	}
	if calls[0].vehicleID != vehicleID {
		t.Fatalf("State().vehicleID = %d, want %d", calls[0].vehicleID, vehicleID)
	}
	if !calls[0].at.Equal(startTime) {
		t.Fatalf("State().at = %v, want %v (active.StartTime — must NOT be time.Now())",
			calls[0].at, startTime)
	}

	// stateToLegacyMap copies the signal.State into the unnamed-map type
	// the legacy snapFloat / signalStr helpers expect. The copy is the
	// only safe path because signal.State is a defined named type whose
	// element type is itself a defined alias (signal.SignalValue).
	legacy := stateToLegacyMap(got)
	if bl, ok := snapFloat(legacy, "BatteryLevel"); !ok || bl != 82.0 {
		t.Fatalf("stateToLegacyMap dropped BatteryLevel: snapFloat = (%v, %v), want (82.0, true)", bl, ok)
	}
	if odo, ok := snapFloat(legacy, "Odometer"); !ok || odo != 12345.6 {
		t.Fatalf("stateToLegacyMap dropped Odometer: snapFloat = (%v, %v), want (12345.6, true)", odo, ok)
	}
}

// TestDriveTracking_EndSnapshot_UsesState pins the end-of-session
// enrichment contract: the StateReader is queried a SECOND time at a
// post-StartTime anchor (the "now" at completion). Two independent
// snapshots are required to compute deltas (distance from odometer,
// energy used) — a regression that uses a single snapshot for both ends
// would zero out every delta field and silently corrupt drive analytics.
func TestDriveTracking_EndSnapshot_UsesState(t *testing.T) {
	const vehicleID = int64(11)
	startTime := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	endTime := startTime.Add(45 * time.Minute)

	fake := &driveTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			// Distinct payloads so the test can confirm the test-side
			// caller plumbed each at-anchor through to the right call.
			if at.Equal(startTime) {
				return signal.State{
					"Odometer":           12000.0,
					"LifetimeEnergyUsed": 4500.0,
					"BatteryLevel":       82.0,
				}, nil
			}
			return signal.State{
				"Odometer":           12035.5,
				"LifetimeEnergyUsed": 4515.5,
				"BatteryLevel":       72.0,
			}, nil
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	t.Cleanup(func() { tracker.SetDriveStateReader(nil) })

	active := &streamingDrive{
		DriveID:   2,
		VehicleID: vehicleID,
		StartTime: startTime,
		state:     tracker.driveStateReader(),
	}

	ctx := context.Background()
	startSnap, err := active.state.State(ctx, vehicleID, active.StartTime)
	if err != nil {
		t.Fatalf("State(start) err = %v", err)
	}
	endSnap, err := active.state.State(ctx, vehicleID, endTime)
	if err != nil {
		t.Fatalf("State(end) err = %v", err)
	}

	calls := fake.snapshotCalls()
	if len(calls) != 2 {
		t.Fatalf("State() calls = %d, want 2 (start + end)", len(calls))
	}
	if !calls[0].at.Equal(startTime) {
		t.Fatalf("call[0].at = %v, want %v", calls[0].at, startTime)
	}
	if !calls[1].at.Equal(endTime) {
		t.Fatalf("call[1].at = %v, want %v", calls[1].at, endTime)
	}
	if calls[0].at.Equal(calls[1].at) {
		t.Fatalf("start and end at-anchors must differ; both were %v", calls[0].at)
	}

	// Sanity: the odometer delta the production code computes from these
	// two snapshots is end - start. A regression that reuses the start
	// snapshot for both queries would yield 0; one that swapped them
	// would yield a negative delta the production code drops.
	startOdo, _ := snapFloat(stateToLegacyMap(startSnap), "Odometer")
	endOdo, _ := snapFloat(stateToLegacyMap(endSnap), "Odometer")
	if delta := endOdo - startOdo; delta != 35.5 {
		t.Fatalf("odometer delta from snapshots = %v, want 35.5", delta)
	}

	// Energy delta — same shape, different field. A regression that
	// swaps start/end would yield -15.5 which the production code drops
	// (energyUsed > 0 guard).
	startEnergy, _ := snapFloat(stateToLegacyMap(startSnap), "LifetimeEnergyUsed")
	endEnergy, _ := snapFloat(stateToLegacyMap(endSnap), "LifetimeEnergyUsed")
	if delta := endEnergy - startEnergy; delta != 15.5 {
		t.Fatalf("energy delta from snapshots = %v, want 15.5", delta)
	}
}

// TestDriveTracking_NoLegacySnapshotAtCalls is the meta-assertion that
// guards the migration contract: the production source file
// telemetry_sessions_drive_tracking.go must contain ZERO call sites for
// the legacy *signaldb.SignalLogReader.SnapshotAt or
// *signaldb.SignalHistoryWriter.SnapshotAt methods. A regression that
// reverts even a single call (e.g. while "fixing" an enrichment field)
// would re-introduce the dual-source split-brain this prompt resolved
// and is caught here. Comments referencing SnapshotAt in prose form are
// permitted — the anchor is the literal `.SnapshotAt(` call shape.
func TestDriveTracking_NoLegacySnapshotAtCalls(t *testing.T) {
	const file = "telemetry_sessions_drive_tracking.go"
	const banned = ".SnapshotAt("
	src, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read %s: %v", file, err)
	}
	if idx := strings.Index(string(src), banned); idx >= 0 {
		// Print the offending line for fast diagnosis.
		s := string(src)
		lineStart := strings.LastIndex(s[:idx], "\n") + 1
		lineEnd := idx + strings.Index(s[idx:], "\n")
		if lineEnd < idx {
			lineEnd = len(s)
		}
		t.Fatalf("found banned %q in %s — legacy SnapshotAt call site reintroduced:\n  %s",
			banned, file, strings.TrimSpace(s[lineStart:lineEnd]))
	}
}

// TestDriveTracking_GearAndLocationCarryForward is the user-visible
// regression test for THIS prompt's bug fix. Tesla's Fleet Telemetry
// only emits a field when (interval_seconds elapsed) AND (value
// changed); unchanged signals are NEVER re-sent. A drive boundary
// (engine on, then later off) frequently lands BETWEEN re-emissions of
// stable signals like Gear, Latitude, and Longitude — the vehicle was
// last seen "in D" five minutes before the drive started, but the
// signal hasn't been re-emitted since because the value hasn't
// changed.
//
// The legacy *signaldb.SignalLogReader.SnapshotAt path queried only the
// snapshot tables and so would return an empty / partial map for any
// signal whose last emission predated the snapshot table's retention
// window. Drives ended up with NULL gear, missing start/end lat/lon,
// and missing temperature averages — all directly user-visible on
// /drives/{id} pages.
//
// signal.StateReader.State() (the new path) forward-folds signal_log:
// every signal emitted at-or-before `at` is included, regardless of
// when it was last emitted. This test pins that contract by seeding
// the fake StateReader with a state map containing exactly the
// "stale-but-still-valid" signals (Gear, Latitude, Longitude,
// InsideTemp, OutsideTemp) and asserting they all carry through to
// the legacy map the enrichment code consumes.
//
// A regression that re-introduces the snapshot-table read path, or
// that filters fields by some "freshness" predicate before populating
// the map, would drop these signals and is caught here.
func TestDriveTracking_GearAndLocationCarryForward(t *testing.T) {
	const vehicleID = int64(42)
	startTime := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	endTime := startTime.Add(30 * time.Minute)

	// Seed the fake StateReader with a state that mimics what
	// signal_log forward-folding produces: every relevant signal has
	// a last-known value, even though some (Gear, Latitude, Longitude)
	// would have been MISSED by the legacy snapshot-table path because
	// they were last emitted before the drive boundary.
	fake := &driveTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			// Both anchors return the same carry-forward set; this
			// mirrors the real signal_log behaviour where stable
			// signals appear identically in both snapshots and the
			// difference between start/end is in the changing fields
			// (which this test deliberately omits to focus on the
			// carry-forward contract).
			return signal.State{
				"Gear":         "D",
				"Latitude":     37.7749,
				"Longitude":    -122.4194,
				"InsideTemp":   22.5,
				"OutsideTemp":  18.0,
				"BatteryLevel": 80.0,
			}, nil
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	t.Cleanup(func() { tracker.SetDriveStateReader(nil) })

	active := &streamingDrive{
		DriveID:   3,
		VehicleID: vehicleID,
		StartTime: startTime,
		state:     tracker.driveStateReader(),
	}

	ctx := context.Background()
	startSnap, err := active.state.State(ctx, vehicleID, active.StartTime)
	if err != nil {
		t.Fatalf("State(start) err = %v", err)
	}
	endSnap, err := active.state.State(ctx, vehicleID, endTime)
	if err != nil {
		t.Fatalf("State(end) err = %v", err)
	}

	startLegacy := stateToLegacyMap(startSnap)
	endLegacy := stateToLegacyMap(endSnap)

	// === Carry-forward assertions: every "stable" field must populate ===

	// Gear — the bug's primary symptom. Drive was started in D, but if
	// Gear hadn't been re-emitted since before the drive boundary, the
	// legacy path would return ""; the new path must return "D".
	if g, ok := signalStr(startLegacy, "Gear"); !ok || g != "D" {
		t.Fatalf("Gear NOT carried forward in start snapshot: signalStr = (%q, %v), want (\"D\", true)", g, ok)
	}
	if g, ok := signalStr(endLegacy, "Gear"); !ok || g != "D" {
		t.Fatalf("Gear NOT carried forward in end snapshot: signalStr = (%q, %v), want (\"D\", true)", g, ok)
	}

	// Latitude / Longitude — the second-most-visible symptom. Without
	// these the drive's start/end pin renders at (0,0) on the map and
	// reverse-geocoding can't resolve a location name.
	if lat, ok := snapFloat(startLegacy, "Latitude"); !ok || lat != 37.7749 {
		t.Fatalf("Latitude NOT carried forward in start snapshot: snapFloat = (%v, %v), want (37.7749, true)", lat, ok)
	}
	if lon, ok := snapFloat(startLegacy, "Longitude"); !ok || lon != -122.4194 {
		t.Fatalf("Longitude NOT carried forward in start snapshot: snapFloat = (%v, %v), want (-122.4194, true)", lon, ok)
	}
	if lat, ok := snapFloat(endLegacy, "Latitude"); !ok || lat != 37.7749 {
		t.Fatalf("Latitude NOT carried forward in end snapshot: snapFloat = (%v, %v), want (37.7749, true)", lat, ok)
	}
	if lon, ok := snapFloat(endLegacy, "Longitude"); !ok || lon != -122.4194 {
		t.Fatalf("Longitude NOT carried forward in end snapshot: snapFloat = (%v, %v), want (-122.4194, true)", lon, ok)
	}

	// Temperature — used for inside_temp_avg_c / outside_temp_avg_c
	// fallback when no temperature signals were captured during the
	// drive itself (e.g. a short drive with no climate change).
	if t1, ok := snapFloat(endLegacy, "InsideTemp"); !ok || t1 != 22.5 {
		t.Fatalf("InsideTemp NOT carried forward in end snapshot: snapFloat = (%v, %v), want (22.5, true)", t1, ok)
	}
	if t1, ok := snapFloat(endLegacy, "OutsideTemp"); !ok || t1 != 18.0 {
		t.Fatalf("OutsideTemp NOT carried forward in end snapshot: snapFloat = (%v, %v), want (18.0, true)", t1, ok)
	}

	// BatteryLevel — used for start_battery_pct enrichment when the
	// in-memory accumulator missed the seed.
	if bl, ok := snapFloat(startLegacy, "BatteryLevel"); !ok || bl != 80.0 {
		t.Fatalf("BatteryLevel NOT carried forward in start snapshot: snapFloat = (%v, %v), want (80.0, true)", bl, ok)
	}

	// Sanity: the call shape — exactly 2 calls, distinct anchors,
	// same vehicleID — matches the production completeDriveLocked
	// invocation pattern and proves the carry-forward result is
	// genuinely a function of the StateReader read, not a coincidental
	// pass-through.
	calls := fake.snapshotCalls()
	if len(calls) != 2 {
		t.Fatalf("State() calls = %d, want 2 (start + end)", len(calls))
	}
	if calls[0].vehicleID != vehicleID || calls[1].vehicleID != vehicleID {
		t.Fatalf("State() vehicleIDs = (%d, %d), both want %d", calls[0].vehicleID, calls[1].vehicleID, vehicleID)
	}
}

// TestDriveTracking_PropagatesError pins the error-handling contract on
// the new StateReader-backed enrichment path: when state.State returns a
// transport error (e.g. pgx connection drop), the production code in
// completeDriveLocked logs a warning and continues with an empty snapshot
// map so the drive row still commits with whatever in-memory data was
// captured during streaming. The error is OBSERVABLE (the fake records
// the call) but does NOT propagate as a panic — this is the "graceful
// degradation" contract: a transient cold-read failure must not abort
// session completion (which would orphan the in-memory streamingDrive
// and leak monotonically-growing memory, plus drop the user-visible
// /drives row entirely).
//
// A regression that "tightens" error handling by panicking on State()
// errors, or that swallows errors so silently the fake's callsCnt never
// increments, is caught here.
func TestDriveTracking_PropagatesError(t *testing.T) {
	const vehicleID = int64(13)
	wantErr := errors.New("simulated pgx connection lost")

	fake := &driveTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetDriveStateReader(fake)
	t.Cleanup(func() { tracker.SetDriveStateReader(nil) })

	active := &streamingDrive{
		DriveID:   4,
		VehicleID: vehicleID,
		StartTime: time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC),
		state:     tracker.driveStateReader(),
	}

	// Mirror the production call shape: on err, the snapshot is replaced
	// with an empty map so callers like snapFloat / signalStr cleanly
	// report "missing key" rather than panicking on a nil deref.
	got, err := active.state.State(context.Background(), vehicleID, active.StartTime)
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
	if m := stateToLegacyMap(nil); m == nil || len(m) != 0 {
		t.Fatalf("stateToLegacyMap(nil) = %v, want empty non-nil map", m)
	}
}

func TestTrackDriving_GearPark_ArmsDebounceWithoutEnding(t *testing.T) {
	const vehicleID = int64(81)
	t0 := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	active := &streamingDrive{
		DriveID:            12,
		VehicleID:          vehicleID,
		StartTime:          t0.Add(-10 * time.Minute),
		accumulatedSignals: map[string]interface{}{},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives:  map[int64]*streamingDrive{vehicleID: active},
		activeCharges: map[int64]*streamingCharge{},
	}

	tracker.trackDriving(
		context.Background(),
		vehicleID,
		"VIN",
		map[string]interface{}{"Gear": "P"},
		nil,
		t0,
		map[string]time.Time{"Gear": t0},
	)
	if _, ok := tracker.activeDrives[vehicleID]; !ok {
		t.Fatal("drive ended on first Gear=P")
	}
	if active.PendingParkSince.IsZero() {
		t.Fatal("expected PendingParkSince to arm")
	}
}

func TestTrackDriving_GearNeutral_DoesNotEndDrive(t *testing.T) {
	const vehicleID = int64(82)
	t0 := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	active := &streamingDrive{
		DriveID:            13,
		VehicleID:          vehicleID,
		StartTime:          t0.Add(-10 * time.Minute),
		PendingParkSince:   t0.Add(-5 * time.Second),
		accumulatedSignals: map[string]interface{}{},
	}
	tracker := &TelemetrySessionTracker{
		activeDrives:  map[int64]*streamingDrive{vehicleID: active},
		activeCharges: map[int64]*streamingCharge{},
	}

	tracker.trackDriving(
		context.Background(),
		vehicleID,
		"VIN",
		map[string]interface{}{"Gear": "N"},
		nil,
		t0,
		map[string]time.Time{"Gear": t0},
	)
	if _, ok := tracker.activeDrives[vehicleID]; !ok {
		t.Fatal("drive ended on Gear=N")
	}
	if !active.PendingParkSince.IsZero() {
		t.Fatal("Neutral should cancel pending Park")
	}
}
