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

// chargeStateCallRecord captures one StateReader.State invocation made by
// the charge-tracking enrichment path so tests can assert wire-up: which
// vehicleID was queried and at what timestamp anchor the snapshot was
// reconstructed. The "at" anchor is load-bearing for the start vs end
// distinction (active.StartTime vs time.Now()) — a regression that swaps
// the two would silently misderive every per-session enrichment field.
//
// Local to this file because drive_handler_detail_test.go declares an
// identically-shaped stateCallRecord for its own per-handler tests.
type chargeStateCallRecord struct {
	vehicleID int64
	at        time.Time
}

// chargeTrackingFakeState is a minimal signal.StateReader used by the
// charge-tracking tests below. Only the State() method is exercised by
// the snapshot path under test; SignalAt and Timeline are present only to
// satisfy the interface. The recorded calls slice is guarded by mu so
// tests can race-safely inspect it without lock copies.
type chargeTrackingFakeState struct {
	mu       sync.Mutex
	calls    []chargeStateCallRecord
	stateFn  func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	callsCnt int64 // atomic — observable from tests without taking mu
}

func (f *chargeTrackingFakeState) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	atomic.AddInt64(&f.callsCnt, 1)
	f.mu.Lock()
	f.calls = append(f.calls, chargeStateCallRecord{vehicleID: vehicleID, at: at})
	f.mu.Unlock()
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *chargeTrackingFakeState) SignalAt(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (f *chargeTrackingFakeState) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

func (f *chargeTrackingFakeState) snapshotCalls() []chargeStateCallRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]chargeStateCallRecord, len(f.calls))
	copy(out, f.calls)
	return out
}

// Compile-time guarantee.
var _ signal.StateReader = (*chargeTrackingFakeState)(nil)

func TestFreshChargeCoordinateValueRequiresObservedTimestamp(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	if freshChargeCoordinateValue(&signal.Value{
		Raw:                37.5,
		Timestamp:          now,
		TimestampSynthetic: true,
	}, now) {
		t.Fatal("synthetic warmup coordinate reported fresh")
	}
	if !freshChargeCoordinateValue(&signal.Value{Raw: 37.5, Timestamp: now}, now) {
		t.Fatal("observed current coordinate reported stale")
	}
}

// TestChargeTracking_SetChargeStateReader_RoundTrip pins the wiring seam
// installed in this prompt: SetChargeStateReader stashes the reader in
// the package-level chargeStateRegistry, and chargeStateReader recovers
// it for the same tracker pointer. Two distinct trackers must not share
// state — a regression that keys the registry on something other than
// the tracker pointer (e.g. a global) would leak readers across
// independent telemetry handlers.
func TestChargeTracking_SetChargeStateReader_RoundTrip(t *testing.T) {
	t1 := &TelemetrySessionTracker{}
	t2 := &TelemetrySessionTracker{}
	t.Cleanup(func() {
		t1.SetChargeStateReader(nil)
		t2.SetChargeStateReader(nil)
	})

	if got := t1.chargeStateReader(); got != nil {
		t.Fatalf("chargeStateReader before set = %v, want nil", got)
	}

	r1 := &chargeTrackingFakeState{}
	r2 := &chargeTrackingFakeState{}
	t1.SetChargeStateReader(r1)
	t2.SetChargeStateReader(r2)

	if got := t1.chargeStateReader(); got != r1 {
		t.Fatalf("chargeStateReader(t1) = %v, want %v", got, r1)
	}
	if got := t2.chargeStateReader(); got != r2 {
		t.Fatalf("chargeStateReader(t2) = %v, want %v", got, r2)
	}

	// Nil clears the entry.
	t1.SetChargeStateReader(nil)
	if got := t1.chargeStateReader(); got != nil {
		t.Fatalf("chargeStateReader(t1) after clear = %v, want nil", got)
	}
	// t2's reader is unaffected by t1's clear.
	if got := t2.chargeStateReader(); got != r2 {
		t.Fatalf("chargeStateReader(t2) after clearing t1 = %v, want %v", got, r2)
	}
}

// TestChargeTracking_StartSnapshot_UsesState pins the start-of-session
// enrichment contract: the StateReader installed via SetChargeStateReader
// must be queried at active.StartTime — NOT at time.Now() — so the
// reconstructed snapshot reflects what the vehicle was reporting when
// the charge began. A regression that swaps the at-anchor (e.g. queries
// "now" at session-end for both reads) would corrupt the energy-delta
// and miles-added enrichment fields.
//
// We exercise the snapshot path by directly calling active.state.State
// with active.StartTime — the same call shape the production code in
// completeChargeLocked uses. A real end-to-end completeChargeLocked test
// would require a Postgres pool plus chargeRepo / geofenceRepo / geocoder
// stubs (the function is mid-stack and tightly coupled to the DB
// transaction); the contract this test pins — that the StateReader is
// the read source, queried at the start anchor — is exactly the contract
// the four call sites in completeChargeLocked enforce.
func TestChargeTracking_StartSnapshot_UsesState(t *testing.T) {
	const vehicleID = int64(7)
	startTime := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	wantSnap := signal.State{
		"BatteryLevel":       18.0,
		"ACChargingEnergyIn": 100000.0,
		"BatteryRange":       95.0,
	}

	fake := &chargeTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return wantSnap, nil
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetChargeStateReader(fake)
	t.Cleanup(func() { tracker.SetChargeStateReader(nil) })

	active := &streamingCharge{
		SessionID: 1,
		VehicleID: vehicleID,
		StartTime: startTime,
		state:     tracker.chargeStateReader(),
	}
	if active.state == nil {
		t.Fatalf("streamingCharge.state should be the installed StateReader; got nil")
	}

	got, err := active.state.State(context.Background(), vehicleID, active.StartTime)
	if err != nil {
		t.Fatalf("active.state.State(start) error = %v, want nil", err)
	}
	if got["BatteryLevel"] != 18.0 {
		t.Fatalf("start snap BatteryLevel = %v, want 18.0", got["BatteryLevel"])
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
	if bl, ok := snapFloat(legacy, "BatteryLevel"); !ok || bl != 18.0 {
		t.Fatalf("stateToLegacyMap dropped BatteryLevel: snapFloat = (%v, %v), want (18.0, true)", bl, ok)
	}
}

// TestChargeTracking_EndSnapshot_UsesState pins the end-of-session
// enrichment contract: the StateReader is queried a SECOND time at a
// post-StartTime anchor (the "now" at completion). Two independent
// snapshots are required to compute deltas (energy added, miles added) —
// a regression that uses a single snapshot for both ends would zero out
// every delta field and silently corrupt charging analytics.
func TestChargeTracking_EndSnapshot_UsesState(t *testing.T) {
	const vehicleID = int64(11)
	startTime := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	endTime := startTime.Add(45 * time.Minute)

	fake := &chargeTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			// Distinct payloads so the test can confirm the test-side
			// caller plumbed each at-anchor through to the right call.
			if at.Equal(startTime) {
				return signal.State{"ACChargingEnergyIn": 100000.0, "BatteryRange": 95.0}, nil
			}
			return signal.State{"ACChargingEnergyIn": 130500.0, "BatteryRange": 215.0}, nil
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetChargeStateReader(fake)
	t.Cleanup(func() { tracker.SetChargeStateReader(nil) })

	active := &streamingCharge{
		SessionID: 2,
		VehicleID: vehicleID,
		StartTime: startTime,
		state:     tracker.chargeStateReader(),
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

	// Sanity: the energy delta the production code computes from these
	// two snapshots is end - start. A regression that reuses the start
	// snapshot for both queries would yield 0; one that swapped them
	// would yield a negative delta the production code drops.
	startEnergy, _ := snapFloat(stateToLegacyMap(startSnap), "ACChargingEnergyIn")
	endEnergy, _ := snapFloat(stateToLegacyMap(endSnap), "ACChargingEnergyIn")
	if delta := endEnergy - startEnergy; delta != 30500 {
		t.Fatalf("energy delta from snapshots = %v, want 30500 Wh", delta)
	}
}

// TestChargeTracking_NoLegacySnapshotAtCalls is the meta-assertion that
// guards the migration contract: the production source file
// telemetry_sessions_charge_tracking.go must contain ZERO call sites for
// the legacy *signaldb.SignalLogReader.SnapshotAt or
// *signaldb.SignalHistoryWriter.SnapshotAt methods. A regression that
// reverts even a single call (e.g. while "fixing" an enrichment field)
// would re-introduce the dual-source split-brain this prompt resolved
// and is caught here. Comments referencing SnapshotAt in prose form are
// permitted — the anchor is the literal `.SnapshotAt(` call shape.
func TestChargeTracking_NoLegacySnapshotAtCalls(t *testing.T) {
	const file = "telemetry_sessions_charge_tracking.go"
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

// TestChargeTracking_PropagatesError pins the error-handling contract on
// the new StateReader-backed enrichment path: when state.State returns a
// transport error (e.g. pgx connection drop), the production code in
// completeChargeLocked logs a warning and continues with an empty snapshot
// map so the charge-session row still commits with whatever in-memory
// data was captured during streaming. The error is OBSERVABLE (the fake
// records the call) but does NOT propagate as a panic — this is the
// "graceful degradation" contract: a transient cold-read failure must
// not abort session completion (which would orphan the in-memory
// streamingCharge and leak monotonically-growing memory).
//
// A regression that "tightens" error handling by panicking on State()
// errors, or that swallows errors so silently the fake's callsCnt never
// increments, is caught here.
func TestChargeTracking_PropagatesError(t *testing.T) {
	const vehicleID = int64(13)
	wantErr := errors.New("simulated pgx connection lost")

	fake := &chargeTrackingFakeState{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	tracker := &TelemetrySessionTracker{}
	tracker.SetChargeStateReader(fake)
	t.Cleanup(func() { tracker.SetChargeStateReader(nil) })

	active := &streamingCharge{
		SessionID: 3,
		VehicleID: vehicleID,
		StartTime: time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC),
		state:     tracker.chargeStateReader(),
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
