package normalize

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// recordingObserver captures every OnPayloadProcessed invocation so
// tests can assert call counts, ordering, and payload contents.
// Concurrent-safe via the embedded mutex; AtomicsObserver
// implementations may be invoked from arbitrary goroutines in
// production wiring (the Pipeline itself invokes them on the caller's
// goroutine, but a future fan-out wrapper might not).
type recordingObserver struct {
	name string
	mu   sync.Mutex
	// captured holds a defensive copy of every atomics slice the
	// observer received, so mutations after the OnPayloadProcessed
	// call cannot affect what tests see.
	captured     [][]codec.Atomic
	vehicleIDs   []int64
	callCount    int
	panicMessage string // when set, OnPayloadProcessed panics with this string

	// orderTicker is shared across observers in a single test to
	// record the ORDER in which they were invoked (rather than just
	// counting them).
	orderTicker *atomicCounter
	orderIndex  int64 // -1 until invoked; non-negative ticker value once invoked
}

func newRecordingObserver(name string) *recordingObserver {
	return &recordingObserver{name: name, orderIndex: -1}
}

func (o *recordingObserver) OnPayloadProcessed(_ context.Context, vehicleID int64, atomics []codec.Atomic) {
	o.mu.Lock()
	o.callCount++
	o.vehicleIDs = append(o.vehicleIDs, vehicleID)
	cp := make([]codec.Atomic, len(atomics))
	copy(cp, atomics)
	o.captured = append(o.captured, cp)
	if o.orderTicker != nil {
		o.orderIndex = o.orderTicker.next()
	}
	panicMsg := o.panicMessage
	o.mu.Unlock()
	if panicMsg != "" {
		panic(panicMsg)
	}
}

func (o *recordingObserver) calls() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.callCount
}

func (o *recordingObserver) lastCapture() []codec.Atomic {
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.captured) == 0 {
		return nil
	}
	return o.captured[len(o.captured)-1]
}

// atomicCounter hands out monotonically increasing ticks shared
// across observers in a test that needs to assert invocation order
// (observers may share an instance).
type atomicCounter struct{ v int64 }

func (c *atomicCounter) next() int64 { return atomic.AddInt64(&c.v, 1) }

// ---------------------------------------------------------------------------
// Decision #9 (a): Pipeline.Process invokes the observer with the full
// post-route atomics slice; Value fields hold SI values for unit-bearing
// fields that converted successfully.
// ---------------------------------------------------------------------------

func TestPipelineObserver_InvokedWithPostRouteAtomicsSlice(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 99
	tNow := time.Date(2026, 5, 5, 9, 0, 0, 0, time.UTC)

	atomics := []codec.Atomic{
		// Setting*Unit first so the subsequent Odometer lookup resolves
		// the unit context. The dispatcher's stable sort would also do
		// this, but spelling it out makes the test independent of sort
		// behaviour.
		{Field: "SettingDistanceUnit", Value: "Kilometers", EmittedAt: tNow, VehicleID: "VIN-OBS-A"},
		// Unit-bearing field that converts: 100 km -> 100000 m.
		{Field: "Odometer", Value: float64(100), EmittedAt: tNow.Add(time.Second), VehicleID: "VIN-OBS-A"},
		// Pass-through (dimensionless) atomic — observer should see the
		// codec-original Value unchanged.
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: tNow.Add(2 * time.Second), VehicleID: "VIN-OBS-A"},
	}

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	obs := newRecordingObserver("primary")
	p := New(repo, rt, zerolog.Nop(), obs)

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	if got := obs.calls(); got != 1 {
		t.Fatalf("observer call count = %d, want 1", got)
	}
	captured := obs.lastCapture()
	if len(captured) != 3 {
		t.Fatalf("observer captured %d atomics, want 3: %+v", len(captured), captured)
	}

	// The observer must see the SI value for Odometer. Odometer is
	// a fixed-mile field (units.IsFixedMileDistanceField) so the
	// conversion is raw * 1609.344 regardless of the recorded
	// SettingDistanceUnit=Kilometers above; the bypass is the
	// regression net for the "10,334 mi drive" production bug.
	odo := findAtomic(captured, "Odometer")
	if odo == nil {
		t.Fatalf("observer slice missing Odometer; got %+v", captured)
	}
	odoSI, ok := odo.Value.(float64)
	if !ok {
		t.Fatalf("observer Odometer Value type = %T, want float64", odo.Value)
	}
	const want = 100 * 1609.344 // 160934.4
	if odoSI != want {
		t.Errorf("observer Odometer Value = %v, want %v (raw * 1609.344, fixed-mile bypass)", odoSI, want)
	}

	// Pass-through field must retain its codec-original Value.
	heater := findAtomic(captured, "BatteryHeaterOn")
	if heater == nil {
		t.Fatalf("observer slice missing BatteryHeaterOn; got %+v", captured)
	}
	if v, ok := heater.Value.(bool); !ok || !v {
		t.Errorf("observer BatteryHeaterOn Value = %v (%T), want true (bool)", heater.Value, heater.Value)
	}

	// Setting*Unit atomic must retain its codec-canonicalized short
	// string ("Kilometers"). The observer is informational here; the
	// unit history side-effect is owned by observeSettingUnit, not
	// by this observer fan-out.
	sdu := findAtomic(captured, "SettingDistanceUnit")
	if sdu == nil {
		t.Fatalf("observer slice missing SettingDistanceUnit; got %+v", captured)
	}
	if v, ok := sdu.Value.(string); !ok || v != "Kilometers" {
		t.Errorf("observer SettingDistanceUnit Value = %v (%T), want \"Kilometers\" (string, codec-canonicalized)", sdu.Value, sdu.Value)
	}

	// vehicleID is propagated verbatim.
	if len(obs.vehicleIDs) != 1 || obs.vehicleIDs[0] != vehicleID {
		t.Errorf("observer vehicleIDs = %v, want [%d]", obs.vehicleIDs, vehicleID)
	}
}

func TestPipelineObserver_ExcludesAtomicsRejectedByNormalization(t *testing.T) {
	t.Parallel()

	emittedAt := time.Date(2026, 5, 5, 9, 0, 0, 0, time.UTC)
	atomics := []codec.Atomic{
		{
			Field:     "VehicleSpeed",
			Value:     float64(72),
			EmittedAt: emittedAt,
			VehicleID: "VIN-NO-UNIT",
		},
		{
			Field:     "BatteryHeaterOn",
			Value:     true,
			EmittedAt: emittedAt,
			VehicleID: "VIN-NO-UNIT",
		},
	}

	obs := newRecordingObserver("accepted-only")
	p := New(&fakeRepo{}, &fakeRouter{}, zerolog.Nop(), obs)
	if err := p.processAtomics(context.Background(), atomics, 41); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	captured := obs.lastCapture()
	if len(captured) != 1 {
		t.Fatalf("observer captured %d atomics, want only accepted pass-through value: %+v", len(captured), captured)
	}
	if captured[0].Field != "BatteryHeaterOn" {
		t.Fatalf("observer captured field %q, want BatteryHeaterOn", captured[0].Field)
	}
}

func findAtomic(atomics []codec.Atomic, field string) *codec.Atomic {
	for i := range atomics {
		if atomics[i].Field == field {
			return &atomics[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Decision #9 (b): observer is NOT invoked when codec.Decode fails.
// Process returns ErrPayloadDrop without populating any atomics, so the
// route loop and observer fan-out are both skipped.
// ---------------------------------------------------------------------------

func TestPipelineObserver_NotInvokedOnDecodeFailure(t *testing.T) {
	t.Parallel()

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	obs := newRecordingObserver("primary")
	p := New(repo, rt, zerolog.Nop(), obs)

	// proto.Unmarshal of arbitrary non-protobuf bytes fails, so
	// codec.Decode returns the wrapped error and Process surfaces it
	// under ErrPayloadDrop. The observer must never fire for the
	// dropped payload — there are no atomics to report.
	err := p.Process(context.Background(), []byte("definitely not a protobuf payload"), 1)
	if !errors.Is(err, ErrPayloadDrop) {
		t.Fatalf("Process returned %v, want ErrPayloadDrop wrap", err)
	}
	if got := obs.calls(); got != 0 {
		t.Errorf("observer was invoked %d time(s) on a dropped payload, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// Decision #9 (c): a panic in an observer is recovered and logged at
// WARN; Process still returns nil and subsequent observers still run.
// ---------------------------------------------------------------------------

func TestPipelineObserver_PanicRecoveredAndLogged(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 11
	tNow := time.Date(2026, 5, 5, 10, 0, 0, 0, time.UTC)
	atomics := []codec.Atomic{
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: tNow, VehicleID: "VIN-PANIC"},
	}

	// Capture WARN logs into a buffer so we can assert the
	// notifyObserver wrapper logged the recovered panic.
	var buf bytes.Buffer
	logger := zerolog.New(&buf)

	panicker := newRecordingObserver("panicker")
	panicker.panicMessage = "boom from observer"
	survivor := newRecordingObserver("survivor")

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, logger, panicker, survivor)

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v (observer panic should not surface)", err)
	}

	if got := panicker.calls(); got != 1 {
		t.Errorf("panicker call count = %d, want 1 (observer ran before panicking)", got)
	}
	if got := survivor.calls(); got != 1 {
		t.Errorf("survivor call count = %d, want 1 (panic in earlier observer must not block subsequent observers)", got)
	}

	logged := buf.String()
	if !strings.Contains(logged, `"level":"warn"`) {
		t.Errorf("expected WARN log for recovered panic; got: %s", logged)
	}
	if !strings.Contains(logged, "boom from observer") {
		t.Errorf("expected log to capture panic value; got: %s", logged)
	}
	if !strings.Contains(logged, "AtomicsObserver panicked") {
		t.Errorf("expected log message body to include 'AtomicsObserver panicked'; got: %s", logged)
	}
}

// ---------------------------------------------------------------------------
// Decision #9 (d): multiple observers are invoked in REGISTRATION ORDER.
// The recordingObserver shares an atomicCounter so each observer's
// orderIndex captures the relative tick at which it was invoked.
// ---------------------------------------------------------------------------

func TestPipelineObserver_RunInRegistrationOrder(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 22
	tNow := time.Date(2026, 5, 5, 11, 0, 0, 0, time.UTC)
	atomics := []codec.Atomic{
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: tNow, VehicleID: "VIN-ORDER"},
	}

	ticker := &atomicCounter{}
	first := newRecordingObserver("first")
	first.orderTicker = ticker
	second := newRecordingObserver("second")
	second.orderTicker = ticker
	third := newRecordingObserver("third")
	third.orderTicker = ticker

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop(), first, second, third)

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	// Tick assignments MUST be 1, 2, 3 in registration order
	// (atomicCounter starts at 0 and increments with .next()).
	if first.orderIndex != 1 {
		t.Errorf("first.orderIndex = %d, want 1 (first registered must run first)", first.orderIndex)
	}
	if second.orderIndex != 2 {
		t.Errorf("second.orderIndex = %d, want 2", second.orderIndex)
	}
	if third.orderIndex != 3 {
		t.Errorf("third.orderIndex = %d, want 3", third.orderIndex)
	}
}

// ---------------------------------------------------------------------------
// Registering zero observers is the supported no-op path.
// ---------------------------------------------------------------------------

func TestPipelineObserver_ZeroObserversNoOp(t *testing.T) {
	t.Parallel()

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop()) // no observers

	atomics := []codec.Atomic{
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: time.Now().UTC(), VehicleID: "VIN-NOOBS"},
	}
	if err := p.processAtomics(context.Background(), atomics, 33); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}
	// Existence test: a fakeRouter receiving the atomic verifies the
	// dispatch loop ran end-to-end with no observers wired.
	got := rt.routesCopy()
	if len(got) != 1 || got[0].Field != "BatteryHeaterOn" {
		t.Errorf("router routes = %+v, want exactly 1 BatteryHeaterOn", got)
	}
}

// ---------------------------------------------------------------------------
// Construction guard: variadic registration order survives a caller
// mutating its own backing slice after New returns. Defensive copy
// inside New makes the observer list stable for the lifetime of the
// Pipeline.
// ---------------------------------------------------------------------------

func TestPipelineObserver_ConstructorDefensivelyCopiesObserverSlice(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 44
	tNow := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	atomics := []codec.Atomic{
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: tNow, VehicleID: "VIN-COPY"},
	}

	first := newRecordingObserver("first")
	second := newRecordingObserver("second")
	caller := []AtomicsObserver{first, second}

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop(), caller...)

	// Mutate the caller's slice AFTER construction. The Pipeline's
	// internal observer list MUST be unaffected.
	caller[0] = newRecordingObserver("usurper")

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}
	if got := first.calls(); got != 1 {
		t.Errorf("first observer was DROPPED by caller-side mutation; calls=%d want 1", got)
	}
	if got := second.calls(); got != 1 {
		t.Errorf("second observer calls=%d want 1", got)
	}
}

// ---------------------------------------------------------------------------
// Compile-time interface conformance: declaring the var here keeps the
// package-level surface consistent with the writers package convention
// and ensures a test fake is ALWAYS the canonical AtomicsObserver shape.
// ---------------------------------------------------------------------------

var _ AtomicsObserver = (*recordingObserver)(nil)
