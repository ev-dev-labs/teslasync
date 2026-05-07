package teslapipeline

import (
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

// ---------------------------------------------------------------------------
// Test fakes — one per callback interface. Each fake records every
// invocation in op-arrival order so tests can assert call counts AND
// the relative ordering across callbacks.
// ---------------------------------------------------------------------------

// callRecorder hands out monotonically increasing tick numbers shared
// across every fake in a test. The k-th fake to be invoked records
// orderTick=k. This lets the ordering tests assert "live before fsm"
// and "sse last" with a single shared counter rather than per-pair
// before/after wiring.
type callRecorder struct{ ticks int64 }

func (r *callRecorder) next() int64 { return atomic.AddInt64(&r.ticks, 1) }

type fakeLiveStore struct {
	mu        sync.Mutex
	calls     int
	lastVeh   int64
	lastSigs  map[string]any
	err       error
	rec       *callRecorder
	orderTick int64
}

func (s *fakeLiveStore) UpdateAll(_ context.Context, vehicleID int64, signals map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastVeh = vehicleID
	s.lastSigs = signals
	if s.rec != nil {
		s.orderTick = s.rec.next()
	}
	return s.err
}

type fakeHistoryWriter struct {
	mu        sync.Mutex
	calls     int
	lastVeh   int64
	lastSigs  map[string]any
	rec       *callRecorder
	orderTick int64
}

func (w *fakeHistoryWriter) Append(vehicleID int64, signals map[string]any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.calls++
	w.lastVeh = vehicleID
	w.lastSigs = signals
	if w.rec != nil {
		w.orderTick = w.rec.next()
	}
}

type fakeFSMHandler struct {
	mu             sync.Mutex
	calls          int
	lastVeh        int64
	lastSigs       map[string]any
	lastPayloadTs  time.Time
	lastFieldTs    map[string]time.Time
	rec            *callRecorder
	orderTick      int64
}

func (f *fakeFSMHandler) ProcessSignals(_ context.Context, vehicleID int64, signals map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastVeh = vehicleID
	f.lastSigs = signals
	if f.rec != nil {
		f.orderTick = f.rec.next()
	}
}

func (f *fakeFSMHandler) ProcessSignalsAt(_ context.Context, vehicleID int64, signals map[string]any, payloadTs time.Time, fieldTs map[string]time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastVeh = vehicleID
	f.lastSigs = signals
	f.lastPayloadTs = payloadTs
	if fieldTs != nil {
		f.lastFieldTs = make(map[string]time.Time, len(fieldTs))
		for k, v := range fieldTs {
			f.lastFieldTs[k] = v
		}
	} else {
		f.lastFieldTs = nil
	}
	if f.rec != nil {
		f.orderTick = f.rec.next()
	}
}

type fakeSessionTracker struct {
	mu             sync.Mutex
	calls          int
	lastVeh        int64
	lastVin        string
	lastSigs       map[string]any
	lastAccum      map[string]any
	lastPayloadTs  time.Time
	lastFieldTs    map[string]time.Time
	rec            *callRecorder
	orderTick      int64
}

func (s *fakeSessionTracker) ProcessSignals(_ context.Context, vehicleID int64, vin string, signals, accumulated map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastVeh = vehicleID
	s.lastVin = vin
	s.lastSigs = signals
	s.lastAccum = accumulated
	if s.rec != nil {
		s.orderTick = s.rec.next()
	}
}

func (s *fakeSessionTracker) ProcessSignalsAt(_ context.Context, vehicleID int64, vin string, signals, accumulated map[string]any, payloadTs time.Time, fieldTs map[string]time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastVeh = vehicleID
	s.lastVin = vin
	s.lastSigs = signals
	s.lastAccum = accumulated
	s.lastPayloadTs = payloadTs
	if fieldTs != nil {
		s.lastFieldTs = make(map[string]time.Time, len(fieldTs))
		for k, v := range fieldTs {
			s.lastFieldTs[k] = v
		}
	} else {
		s.lastFieldTs = nil
	}
	if s.rec != nil {
		s.orderTick = s.rec.next()
	}
}

type fakeAlertEvaluator struct {
	mu         sync.Mutex
	calls      int
	lastVeh    int64
	lastVin    string
	lastSigs   map[string]any
	lastAccum  map[string]any
	rec        *callRecorder
	orderTick  int64
}

func (e *fakeAlertEvaluator) Evaluate(_ context.Context, vehicleID int64, vin string, signals, accumulated map[string]any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls++
	e.lastVeh = vehicleID
	e.lastVin = vin
	e.lastSigs = signals
	e.lastAccum = accumulated
	if e.rec != nil {
		e.orderTick = e.rec.next()
	}
}

type fakeVINResolver struct {
	mu      sync.Mutex
	calls   int
	lastVeh int64
	vin     string
	err     error
}

func (r *fakeVINResolver) VINByID(_ context.Context, vehicleID int64) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	r.lastVeh = vehicleID
	return r.vin, r.err
}

type fakeBroadcaster struct {
	mu        sync.Mutex
	calls     int
	last      map[string]any
	rec       *callRecorder
	orderTick int64
}

func (b *fakeBroadcaster) call(payload map[string]any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.calls++
	b.last = payload
	if b.rec != nil {
		b.orderTick = b.rec.next()
	}
}

// newFakeKit constructs a default-good kit of all 7 fake dependencies
// + a shared callRecorder. Tests mutate individual fields (err,
// vin, etc.) before calling New.
func newFakeKit() (*fakeLiveStore, *fakeHistoryWriter, *fakeFSMHandler, *fakeSessionTracker, *fakeAlertEvaluator, *fakeVINResolver, *fakeBroadcaster, *callRecorder) {
	rec := &callRecorder{}
	live := &fakeLiveStore{rec: rec}
	hist := &fakeHistoryWriter{rec: rec}
	fsm := &fakeFSMHandler{rec: rec}
	sess := &fakeSessionTracker{rec: rec}
	alerts := &fakeAlertEvaluator{rec: rec}
	vin := &fakeVINResolver{vin: "VIN-DEFAULT"}
	bcast := &fakeBroadcaster{rec: rec}
	return live, hist, fsm, sess, alerts, vin, bcast, rec
}

func newDefaultObserver(t *testing.T) (*SideEffectsObserver, *fakeLiveStore, *fakeHistoryWriter, *fakeFSMHandler, *fakeSessionTracker, *fakeAlertEvaluator, *fakeVINResolver, *fakeBroadcaster) {
	t.Helper()
	live, hist, fsm, sess, alerts, vin, bcast, _ := newFakeKit()
	obs := New(Config{
		Live:         live,
		History:      hist,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vin,
		BroadcastSSE: bcast.call,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC) },
	})
	return obs, live, hist, fsm, sess, alerts, vin, bcast
}

// ---------------------------------------------------------------------------
// Decision #10 (a): atomics map conversion — 3 atomics produce a 3-key
// map keyed on Field with values matching the (post-route) Atomic.Value.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_AtomicsConvertedToSignalsMap(t *testing.T) {
	t.Parallel()

	obs, live, _, _, _, _, _, _ := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 12.5, EmittedAt: time.Now(), VehicleID: "VIN-A"},     // SI value (m/s)
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: time.Now(), VehicleID: "VIN-A"},  // pass-through bool
		{Field: "Gear", Value: "P", EmittedAt: time.Now(), VehicleID: "VIN-A"},              // string enum
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	if live.calls != 1 {
		t.Fatalf("live.calls = %d, want 1", live.calls)
	}
	if got := len(live.lastSigs); got != 3 {
		t.Fatalf("signals map size = %d, want 3", got)
	}
	if v, ok := live.lastSigs["VehicleSpeed"].(float64); !ok || v != 12.5 {
		t.Errorf("signals[VehicleSpeed] = %v (%T), want 12.5 (float64)", live.lastSigs["VehicleSpeed"], live.lastSigs["VehicleSpeed"])
	}
	if v, ok := live.lastSigs["BatteryHeaterOn"].(bool); !ok || !v {
		t.Errorf("signals[BatteryHeaterOn] = %v (%T), want true (bool)", live.lastSigs["BatteryHeaterOn"], live.lastSigs["BatteryHeaterOn"])
	}
	if v, ok := live.lastSigs["Gear"].(string); !ok || v != "P" {
		t.Errorf("signals[Gear] = %v (%T), want \"P\" (string)", live.lastSigs["Gear"], live.lastSigs["Gear"])
	}
}

// ---------------------------------------------------------------------------
// Phase-42a/0030.bis (commit C2 of v3.4 prod-replay accuracy fix):
// per-field event-time threading. The observer reduces []codec.Atomic →
// map[Field]Value but MUST also expose two timing channels:
//
//   - payloadTs = max(EmittedAt) across the batch (high-water mark)
//   - fieldTs   = per-Field EmittedAt of the surviving (last-write-wins)
//                 Value
//
// These are forwarded to ProcessSignalsAt on FSM + SessionTracker so that
// drives stamped from a replay batch reflect the original event-time
// (e.g. 2026-04-18 00:22 UTC) instead of wall-clock at replay time.
// Without this, a 24-min replay batch collapses to one wall-clock instant
// and produces 11s "drives" 24min after replay (the prod bug this fix
// addresses).
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_ThreadsPerFieldEventTimeToFSMAndSessions(t *testing.T) {
	t.Parallel()

	obs, _, _, fsm, sess, _, _, _ := newDefaultObserver(t)

	gearTs := time.Date(2026, 4, 18, 0, 22, 13, 0, time.UTC)
	speedTs := time.Date(2026, 4, 18, 0, 22, 14, 0, time.UTC)
	batteryTs := time.Date(2026, 4, 18, 0, 22, 12, 0, time.UTC)

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "D", EmittedAt: gearTs, VehicleID: "VIN-EVENT"},
		{Field: "VehicleSpeed", Value: 12.5, EmittedAt: speedTs, VehicleID: "VIN-EVENT"},
		{Field: "BatteryLevel", Value: 78.0, EmittedAt: batteryTs, VehicleID: "VIN-EVENT"},
	}
	obs.OnPayloadProcessed(context.Background(), 7, atomics)

	// payloadTs == max(EmittedAt) == speedTs
	if !fsm.lastPayloadTs.Equal(speedTs) {
		t.Errorf("fsm.lastPayloadTs = %v, want %v (max EmittedAt)", fsm.lastPayloadTs, speedTs)
	}
	if !sess.lastPayloadTs.Equal(speedTs) {
		t.Errorf("sessions.lastPayloadTs = %v, want %v (max EmittedAt)", sess.lastPayloadTs, speedTs)
	}

	// fieldTs preserves per-atomic EmittedAt
	if got := fsm.lastFieldTs["Gear"]; !got.Equal(gearTs) {
		t.Errorf("fsm.lastFieldTs[Gear] = %v, want %v", got, gearTs)
	}
	if got := fsm.lastFieldTs["VehicleSpeed"]; !got.Equal(speedTs) {
		t.Errorf("fsm.lastFieldTs[VehicleSpeed] = %v, want %v", got, speedTs)
	}
	if got := fsm.lastFieldTs["BatteryLevel"]; !got.Equal(batteryTs) {
		t.Errorf("fsm.lastFieldTs[BatteryLevel] = %v, want %v", got, batteryTs)
	}
	if got := sess.lastFieldTs["Gear"]; !got.Equal(gearTs) {
		t.Errorf("sessions.lastFieldTs[Gear] = %v, want %v", got, gearTs)
	}

	// Field count must equal atomic count (no fields silently dropped)
	if len(fsm.lastFieldTs) != 3 {
		t.Errorf("len(fsm.lastFieldTs) = %d, want 3", len(fsm.lastFieldTs))
	}
}

// Duplicate Field with later EmittedAt wins (last-write-wins on the value)
// AND its EmittedAt is the one preserved in fieldTs.
func TestSideEffectsObserver_DuplicateFieldKeepsLatestEmittedAtInFieldTs(t *testing.T) {
	t.Parallel()

	obs, _, _, fsm, _, _, _, _ := newDefaultObserver(t)

	first := time.Date(2026, 4, 18, 0, 22, 10, 0, time.UTC)
	second := time.Date(2026, 4, 18, 0, 22, 11, 0, time.UTC)

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "D", EmittedAt: first, VehicleID: "VIN-DUP"},
		{Field: "Gear", Value: "P", EmittedAt: second, VehicleID: "VIN-DUP"},
	}
	obs.OnPayloadProcessed(context.Background(), 9, atomics)

	// last-write-wins on value
	if v, ok := fsm.lastSigs["Gear"].(string); !ok || v != "P" {
		t.Errorf("fsm.lastSigs[Gear] = %v, want P", fsm.lastSigs["Gear"])
	}
	// fieldTs reflects the surviving atomic's EmittedAt
	if got := fsm.lastFieldTs["Gear"]; !got.Equal(second) {
		t.Errorf("fsm.lastFieldTs[Gear] = %v, want %v (latest)", got, second)
	}
}
// ---------------------------------------------------------------------------
// Decision #10 (b): all 5 callbacks invoked exactly once per payload
// (live, history, fsm, sessions, alerts). SSE counts as a 6th callback
// — also exactly once. VIN lookup counts as a 7th — also exactly once.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_AllCallbacksInvokedOncePerPayload(t *testing.T) {
	t.Parallel()

	obs, live, hist, fsm, sess, alerts, vin, bcast := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 0.0, EmittedAt: time.Now(), VehicleID: "VIN-B"},
	}
	obs.OnPayloadProcessed(context.Background(), 42, atomics)

	if live.calls != 1 {
		t.Errorf("live.calls = %d, want 1", live.calls)
	}
	if hist.calls != 1 {
		t.Errorf("history.calls = %d, want 1", hist.calls)
	}
	if fsm.calls != 1 {
		t.Errorf("fsm.calls = %d, want 1", fsm.calls)
	}
	if sess.calls != 1 {
		t.Errorf("sessions.calls = %d, want 1", sess.calls)
	}
	if alerts.calls != 1 {
		t.Errorf("alerts.calls = %d, want 1", alerts.calls)
	}
	if vin.calls != 1 {
		t.Errorf("vinResolver.calls = %d, want 1", vin.calls)
	}
	if bcast.calls != 1 {
		t.Errorf("broadcastSSE.calls = %d, want 1", bcast.calls)
	}
}

// ---------------------------------------------------------------------------
// Decision #10 (c): VIN lookup is invoked exactly once per payload.
// (Already covered by the previous test, but pinned standalone here for
// the "regression on this exact behavior" gate.)
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_VINLookupInvokedOncePerPayload(t *testing.T) {
	t.Parallel()

	obs, _, _, _, _, _, vin, _ := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "D", EmittedAt: time.Now(), VehicleID: "VIN-C"},
	}
	obs.OnPayloadProcessed(context.Background(), 5, atomics)

	if vin.calls != 1 {
		t.Errorf("VIN lookup invoked %d time(s), want exactly 1", vin.calls)
	}
	if vin.lastVeh != 5 {
		t.Errorf("VIN lookup vehicleID = %d, want 5", vin.lastVeh)
	}
}

// ---------------------------------------------------------------------------
// Decision #10 (d): FSM, sessions, and alerts receive the SAME signals
// map. We assert pointer equality (same backing map) by mutating the
// map seen by FSM and observing the mutation in the maps captured by
// sessions and alerts. This is the strongest possible "same map"
// assertion and catches a future "defensive copy per callback"
// regression that would silently break the legacy contract.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_FSMAndSessionsAndAlertsShareSignalsMap(t *testing.T) {
	t.Parallel()

	obs, _, _, fsm, sess, alerts, _, _ := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 1.0, EmittedAt: time.Now(), VehicleID: "VIN-D"},
	}
	obs.OnPayloadProcessed(context.Background(), 9, atomics)

	if fsm.lastSigs == nil || sess.lastSigs == nil || alerts.lastSigs == nil {
		t.Fatalf("nil map captured: fsm=%v sessions=%v alerts=%v", fsm.lastSigs, sess.lastSigs, alerts.lastSigs)
	}
	// Mutate FSM's map and assert the change is visible through
	// sessions' and alerts' captured map references.
	fsm.lastSigs["__shared_marker__"] = "mutated-via-fsm"
	if v, ok := sess.lastSigs["__shared_marker__"].(string); !ok || v != "mutated-via-fsm" {
		t.Errorf("sessions saw a different map than FSM (sessions[__shared_marker__]=%v); maps must share backing storage per Decision #10(d)", sess.lastSigs["__shared_marker__"])
	}
	if v, ok := alerts.lastSigs["__shared_marker__"].(string); !ok || v != "mutated-via-fsm" {
		t.Errorf("alerts saw a different map than FSM (alerts[__shared_marker__]=%v); maps must share backing storage per Decision #10(d)", alerts.lastSigs["__shared_marker__"])
	}

	// Sessions' accumulated parameter MUST be the same map as
	// signals (Decision #8 — the legacy cross-batch accumulator is
	// not preserved in the bridge, so accumulated == signals).
	if sess.lastAccum == nil {
		t.Fatalf("sessions.lastAccum is nil")
	}
	if v, ok := sess.lastAccum["__shared_marker__"].(string); !ok || v != "mutated-via-fsm" {
		t.Errorf("sessions.accumulated must share the signals map per Decision #8; got accumulated[__shared_marker__]=%v", sess.lastAccum["__shared_marker__"])
	}
	if alerts.lastAccum == nil {
		t.Fatalf("alerts.lastAccum is nil")
	}
	if v, ok := alerts.lastAccum["__shared_marker__"].(string); !ok || v != "mutated-via-fsm" {
		t.Errorf("alerts.accumulated must share the signals map per Decision #8; got accumulated[__shared_marker__]=%v", alerts.lastAccum["__shared_marker__"])
	}
}

// ---------------------------------------------------------------------------
// Decision #10 (e): live store called BEFORE FSM (FSM may read live
// state). Asserted via the shared callRecorder ordering ticks.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_LiveStoreCalledBeforeFSM(t *testing.T) {
	t.Parallel()

	obs, live, _, fsm, _, _, _, _ := newDefaultObserver(t)
	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 5.5, EmittedAt: time.Now(), VehicleID: "VIN-E"},
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	if live.orderTick == 0 || fsm.orderTick == 0 {
		t.Fatalf("ordering ticks missing: live=%d fsm=%d", live.orderTick, fsm.orderTick)
	}
	if live.orderTick >= fsm.orderTick {
		t.Errorf("live.orderTick=%d must be LESS than fsm.orderTick=%d (live must run before FSM so FSM may read live state — Decision #10(e))", live.orderTick, fsm.orderTick)
	}
}

// ---------------------------------------------------------------------------
// Decision #10 (f): SSE called LAST (broadcasts the post-update view).
// Asserted via the shared callRecorder ordering ticks against ALL
// other callbacks.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_SSECalledLast(t *testing.T) {
	t.Parallel()

	obs, live, hist, fsm, sess, alerts, _, bcast := newDefaultObserver(t)
	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 1.0, EmittedAt: time.Now(), VehicleID: "VIN-F"},
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	if bcast.orderTick == 0 {
		t.Fatalf("broadcastSSE was not invoked")
	}
	for _, peer := range []struct {
		name string
		tick int64
	}{
		{"live", live.orderTick},
		{"history", hist.orderTick},
		{"fsm", fsm.orderTick},
		{"sessions", sess.orderTick},
		{"alerts", alerts.orderTick},
	} {
		if peer.tick == 0 {
			t.Errorf("%s was not invoked (tick=0)", peer.name)
			continue
		}
		if peer.tick >= bcast.orderTick {
			t.Errorf("%s.tick=%d must be LESS than broadcastSSE.tick=%d (SSE must run last — Decision #10(f))", peer.name, peer.tick, bcast.orderTick)
		}
	}
}

// ---------------------------------------------------------------------------
// Full ordering pin: live -> history -> fsm -> sessions -> alerts -> sse
// (sessions and alerts can be in either order between themselves but
// MUST sit between fsm and sse). This is the single most important
// behavioural assertion for the bridge — if any future refactor
// reorders the callbacks this test breaks loudly.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_FullCallOrderLivesUpToDesignContract(t *testing.T) {
	t.Parallel()

	obs, live, hist, fsm, sess, alerts, _, bcast := newDefaultObserver(t)
	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 7.7, EmittedAt: time.Now(), VehicleID: "VIN-G"},
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	// live(1) < history(2) < fsm(3) < {sessions, alerts}(4..5) < sse(6)
	if live.orderTick != 1 {
		t.Errorf("live.orderTick = %d, want 1", live.orderTick)
	}
	if hist.orderTick != 2 {
		t.Errorf("history.orderTick = %d, want 2", hist.orderTick)
	}
	if fsm.orderTick != 3 {
		t.Errorf("fsm.orderTick = %d, want 3", fsm.orderTick)
	}
	// Sessions and alerts run consecutively after fsm but before
	// sse. We do NOT pin which runs first because Decision #10
	// names them as a pair without ordering.
	pair := []int64{sess.orderTick, alerts.orderTick}
	if pair[0] == 0 || pair[1] == 0 {
		t.Fatalf("sessions/alerts not invoked: sess=%d alerts=%d", pair[0], pair[1])
	}
	if !((pair[0] == 4 && pair[1] == 5) || (pair[0] == 5 && pair[1] == 4)) {
		t.Errorf("sessions+alerts must run on ticks {4,5} (after fsm, before sse); got sess=%d alerts=%d", pair[0], pair[1])
	}
	if bcast.orderTick != 6 {
		t.Errorf("broadcastSSE.orderTick = %d, want 6 (final tick)", bcast.orderTick)
	}
}

// ---------------------------------------------------------------------------
// VIN lookup failure path: sessions + alerts SKIPPED, but the other
// 4 callbacks proceed. Documents the partial-failure semantics that
// the bridge inherits from the legacy ProcessSignals path (which had
// no VIN lookup but did skip vehicleID-keyed work when vehicleID==0).
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_VINLookupFailureSkipsSessionsAndAlertsOnly(t *testing.T) {
	t.Parallel()

	live, hist, fsm, sess, alerts, vinResolver, bcast, _ := newFakeKit()
	vinResolver.err = errors.New("vehicle not registered")
	obs := New(Config{
		Live:         live,
		History:      hist,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vinResolver,
		BroadcastSSE: bcast.call,
		Logger:       zerolog.Nop(),
	})

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "P", EmittedAt: time.Now(), VehicleID: "VIN-MISSING"},
	}
	obs.OnPayloadProcessed(context.Background(), 999, atomics)

	if live.calls != 1 {
		t.Errorf("live.calls = %d, want 1 (live must run regardless of VIN)", live.calls)
	}
	if hist.calls != 1 {
		t.Errorf("history.calls = %d, want 1 (history must run regardless of VIN)", hist.calls)
	}
	if fsm.calls != 1 {
		t.Errorf("fsm.calls = %d, want 1 (FSM must run regardless of VIN)", fsm.calls)
	}
	if bcast.calls != 1 {
		t.Errorf("broadcastSSE.calls = %d, want 1 (SSE must run regardless of VIN)", bcast.calls)
	}
	if sess.calls != 0 {
		t.Errorf("sessions.calls = %d, want 0 (must skip on VIN lookup failure)", sess.calls)
	}
	if alerts.calls != 0 {
		t.Errorf("alerts.calls = %d, want 0 (must skip on VIN lookup failure)", alerts.calls)
	}
}

// ---------------------------------------------------------------------------
// Live store error path: error is logged at WARN, the rest of the
// callback chain proceeds. This pins the "observer failures must not
// fail the payload" rule (phase-42a/0000 Decision #2) at the
// per-callback granularity.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_LiveStoreErrorDoesNotFailChain(t *testing.T) {
	t.Parallel()

	live, hist, fsm, sess, alerts, vinResolver, bcast, _ := newFakeKit()
	live.err = errors.New("redis publish queue full")

	var logBuf strings.Builder
	logger := zerolog.New(&logBuf)

	obs := New(Config{
		Live:         live,
		History:      hist,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vinResolver,
		BroadcastSSE: bcast.call,
		Logger:       logger,
	})

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "P", EmittedAt: time.Now(), VehicleID: "VIN-LIVEERR"},
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	if live.calls != 1 {
		t.Errorf("live.calls = %d, want 1", live.calls)
	}
	if hist.calls != 1 || fsm.calls != 1 || sess.calls != 1 || alerts.calls != 1 || bcast.calls != 1 {
		t.Errorf("downstream callbacks did not all run after live error: hist=%d fsm=%d sess=%d alerts=%d bcast=%d (want all=1)", hist.calls, fsm.calls, sess.calls, alerts.calls, bcast.calls)
	}
	logged := logBuf.String()
	if !strings.Contains(logged, `"level":"warn"`) {
		t.Errorf("expected WARN log; got: %s", logged)
	}
	if !strings.Contains(logged, "live signal store update failed") {
		t.Errorf("expected log to identify the failed callback; got: %s", logged)
	}
}

// ---------------------------------------------------------------------------
// SSE payload shape: includes vehicle_id, ts (from injected clock),
// and a signals map matching the per-payload signals.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_SSEPayloadShape(t *testing.T) {
	t.Parallel()

	obs, _, _, _, _, _, _, bcast := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "D", EmittedAt: time.Now(), VehicleID: "VIN-SSE"},
		{Field: "VehicleSpeed", Value: 11.1, EmittedAt: time.Now(), VehicleID: "VIN-SSE"},
	}
	obs.OnPayloadProcessed(context.Background(), 314, atomics)

	if bcast.calls != 1 {
		t.Fatalf("broadcastSSE.calls = %d, want 1", bcast.calls)
	}
	if v, ok := bcast.last["vehicle_id"].(int64); !ok || v != 314 {
		t.Errorf("payload[vehicle_id] = %v (%T), want 314 (int64)", bcast.last["vehicle_id"], bcast.last["vehicle_id"])
	}
	wantTs := time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC)
	if v, ok := bcast.last["ts"].(time.Time); !ok || !v.Equal(wantTs) {
		t.Errorf("payload[ts] = %v (%T), want %s (from injected clock)", bcast.last["ts"], bcast.last["ts"], wantTs)
	}
	sigs, ok := bcast.last["signals"].(map[string]any)
	if !ok {
		t.Fatalf("payload[signals] type = %T, want map[string]any", bcast.last["signals"])
	}
	if len(sigs) != 2 {
		t.Errorf("payload signals size = %d, want 2", len(sigs))
	}
	if v, ok := sigs["Gear"].(string); !ok || v != "D" {
		t.Errorf("payload signals[Gear] = %v (%T), want \"D\"", sigs["Gear"], sigs["Gear"])
	}
}

// ---------------------------------------------------------------------------
// Atomics slice immutability: the observer MUST NOT mutate the
// caller's atomics slice. We pass an atomic with a string Value, run
// the observer, and assert the slice element's Value is unchanged.
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_DoesNotMutateAtomicsSlice(t *testing.T) {
	t.Parallel()

	obs, _, _, _, _, _, _, _ := newDefaultObserver(t)

	atomics := []codec.Atomic{
		{Field: "Gear", Value: "D", EmittedAt: time.Now(), VehicleID: "VIN-IMMUT"},
	}
	obs.OnPayloadProcessed(context.Background(), 1, atomics)

	if atomics[0].Field != "Gear" {
		t.Errorf("atomics[0].Field = %q, want \"Gear\" (slice was mutated by observer)", atomics[0].Field)
	}
	if v, ok := atomics[0].Value.(string); !ok || v != "D" {
		t.Errorf("atomics[0].Value = %v (%T), want \"D\" (string) — slice was mutated by observer", atomics[0].Value, atomics[0].Value)
	}
}

// ---------------------------------------------------------------------------
// Empty atomics slice: the observer still runs every callback with an
// empty signals map. This is the well-defined behavior for the case
// where codec.Decode returned zero atomics (e.g. a payload of all
// invalid Datums).
// ---------------------------------------------------------------------------

func TestSideEffectsObserver_EmptyAtomicsStillRunsAllCallbacks(t *testing.T) {
	t.Parallel()

	obs, live, hist, fsm, sess, alerts, _, bcast := newDefaultObserver(t)

	obs.OnPayloadProcessed(context.Background(), 1, []codec.Atomic{})

	if live.calls != 1 || hist.calls != 1 || fsm.calls != 1 || sess.calls != 1 || alerts.calls != 1 || bcast.calls != 1 {
		t.Errorf("not all callbacks ran on empty atomics: live=%d hist=%d fsm=%d sess=%d alerts=%d bcast=%d (want all=1)", live.calls, hist.calls, fsm.calls, sess.calls, alerts.calls, bcast.calls)
	}
	if live.lastSigs == nil {
		t.Errorf("signals map is nil on empty atomics; should be empty (non-nil) so callbacks see len()==0")
	}
	if len(live.lastSigs) != 0 {
		t.Errorf("signals map size = %d, want 0", len(live.lastSigs))
	}
}

// ---------------------------------------------------------------------------
// Constructor guards: every nil dependency triggers a panic. Pinned
// per-arg so a future refactor that drops a guard surfaces in this
// test rather than in a silent-no-op production regression.
// ---------------------------------------------------------------------------

func TestNew_NilDependenciesPanic(t *testing.T) {
	t.Parallel()

	live, hist, fsm, sess, alerts, vin, bcast, _ := newFakeKit()
	good := Config{
		Live:         live,
		History:      hist,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vin,
		BroadcastSSE: bcast.call,
	}

	cases := []struct {
		name  string
		mut   func(c *Config)
		match string
	}{
		{"Live", func(c *Config) { c.Live = nil }, "Config.Live"},
		{"History", func(c *Config) { c.History = nil }, "Config.History"},
		{"FSM", func(c *Config) { c.FSM = nil }, "Config.FSM"},
		{"Sessions", func(c *Config) { c.Sessions = nil }, "Config.Sessions"},
		{"Alerts", func(c *Config) { c.Alerts = nil }, "Config.Alerts"},
		{"VINResolver", func(c *Config) { c.VINResolver = nil }, "Config.VINResolver"},
		{"BroadcastSSE", func(c *Config) { c.BroadcastSSE = nil }, "Config.BroadcastSSE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := good
			tc.mut(&cfg)
			defer func() {
				r := recover()
				if r == nil {
					t.Fatalf("expected panic for nil %s; New returned normally", tc.name)
				}
				msg, _ := r.(string)
				if !strings.Contains(msg, tc.match) {
					t.Errorf("panic message = %q, want to contain %q", msg, tc.match)
				}
			}()
			_ = New(cfg)
		})
	}
}

// ---------------------------------------------------------------------------
// Default clock: when Config.Now is nil, the SSE payload's ts uses
// time.Now (UTC). We accept any ts within a reasonable window of the
// test's wall clock to avoid flake.
// ---------------------------------------------------------------------------

func TestNew_DefaultClockUsesWallTime(t *testing.T) {
	t.Parallel()

	live, hist, fsm, sess, alerts, vin, bcast, _ := newFakeKit()
	obs := New(Config{
		Live:         live,
		History:      hist,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vin,
		BroadcastSSE: bcast.call,
		Logger:       zerolog.Nop(),
		// Now: nil — exercise the default clock path
	})

	before := time.Now().UTC().Add(-time.Second)
	obs.OnPayloadProcessed(context.Background(), 1, []codec.Atomic{
		{Field: "Gear", Value: "P"},
	})
	after := time.Now().UTC().Add(time.Second)

	ts, ok := bcast.last["ts"].(time.Time)
	if !ok {
		t.Fatalf("payload[ts] type = %T, want time.Time", bcast.last["ts"])
	}
	if ts.Before(before) || ts.After(after) {
		t.Errorf("payload[ts] = %s; expected within [%s, %s] (wall-clock from default Now)", ts, before, after)
	}
}
