package writers

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// The recorder fake is reused from snapshot_base_test.go (same
// package). The positions writer tests add only what is positions-
// specific: an injected clock, helpers for asserting the buffered-vs-
// flushed boundary, and a richer SQL-shape assertion that checks all
// six positions columns rather than the snapshot helper's single-
// column upsert clause.

// posTestVIN is the canonical VIN used across positions writer tests.
const posTestVIN = "5YJ3E1EA0KF000099"

// newPositionsTestWriter builds a positions writer with the supplied
// recorder and a frozen clock so TTL-eviction tests are deterministic.
// The returned advance function moves the clock forward; passing 0
// keeps the current value.
func newPositionsTestWriter(t *testing.T, rec *recorder) (*positionsWriter, func(time.Duration)) {
	t.Helper()
	w := newPositionsWriter(rec)
	clock := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	var mu sync.Mutex
	w.now = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	}
	advance := func(d time.Duration) {
		mu.Lock()
		defer mu.Unlock()
		clock = clock.Add(d)
	}
	return w, advance
}

// assertPositionsCallShape locks the SQL string the writer uses against
// the LOCKED upsert in positions_writer.go. This is the equivalent of
// snapshot_base_test.go's assertCallShape but tailored to the positions
// helper's six-column INSERT.
func assertPositionsCallShape(t *testing.T, call recordedCall) {
	t.Helper()
	want := []string{
		"INSERT INTO positions",
		"(vehicle_id, ts, lat, lng, heading_deg, gps_state)",
		"FROM vehicles v WHERE v.vin = $1",
		"ON CONFLICT (vehicle_id, ts) DO UPDATE SET",
		"lat = EXCLUDED.lat",
		"lng = EXCLUDED.lng",
		"heading_deg = COALESCE(EXCLUDED.heading_deg, positions.heading_deg)",
		"gps_state = COALESCE(EXCLUDED.gps_state, positions.gps_state)",
	}
	for _, sub := range want {
		if !strings.Contains(call.SQL, sub) {
			t.Errorf("SQL missing %q\nfull SQL: %s", sub, call.SQL)
		}
	}
}

// posAtom is a small helper for terse atomic construction in tests.
func posAtom(field string, value any, ts time.Time) codec.Atomic {
	return codec.Atomic{Field: field, Value: value, EmittedAt: ts, VehicleID: posTestVIN}
}

// dstFor returns a realistic router.Entry. The positions writer ignores
// Entry.Column today, but the value guards against future changes that
// start consulting it.
func dstFor(field, col string) router.Entry {
	return router.Entry{Field: field, Destination: router.DestPositions, Column: col}
}

// TestNewPositionsWriter_PanicsOnNilPool locks the production-only
// fail-fast: a wiring bug that supplies nil must crash at process
// start, not at the first payload.
func TestNewPositionsWriter_PanicsOnNilPool(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for nil pool, got nil")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("recovered value is not a string: %#v", r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message does not mention nil pool: %q", msg)
		}
	}()
	_ = NewPositionsWriter(nil)
}

// TestPositionsWriter_RouterWriterInterface gives a compile-time AND
// runtime assertion that *positionsWriter implements router.Writer.
// The compile check would already fail the package's go build, but
// the runtime check is recorded here so a future refactor that drops
// the interface assertion is caught even if the build is run with
// caching artefacts.
func TestPositionsWriter_RouterWriterInterface(t *testing.T) {
	var w router.Writer = newPositionsWriter(&recorder{rows: 1})
	if w == nil {
		t.Fatal("constructor returned nil, expected non-nil router.Writer")
	}
}

// TestWrite_BuffersSingleField covers the "lat-only" and "lng-only"
// and "heading-only" and "gps-only" arrival cases. None of these
// should issue an Exec call; the entry must remain in the pending
// buffer waiting for the partner.
func TestPositionsWrite_BuffersSingleField(t *testing.T) {
	cases := []struct {
		name  string
		field string
		col   string
		val   any
	}{
		{name: "lat alone", field: "LocationLatitude", col: "lat", val: float64(37.4)},
		{name: "lng alone", field: "LocationLongitude", col: "lng", val: float64(-122.1)},
		{name: "heading alone", field: "GpsHeading", col: "heading_deg", val: float32(90)},
		{name: "gps_state alone", field: "GpsState", col: "gps_state", val: "valid"},
	}
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w, _ := newPositionsTestWriter(t, rec)
			err := w.Write(context.Background(), posAtom(tc.field, tc.val, ts), dstFor(tc.field, tc.col))
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected 0 db calls for buffered atomic, got %d", got)
			}
			if got := len(w.pending); got != 1 {
				t.Errorf("expected 1 pending entry, got %d", got)
			}
		})
	}
}

// TestWrite_LatThenLng verifies the canonical pair-up flow. After
// LocationLatitude lands, the writer is silent; after LocationLongitude
// lands for the same (vin, ts), one INSERT carries both columns. The
// other two columns are NULL (heading_deg, gps_state) because they
// were not supplied — the COALESCE in the upsert preserves any prior
// value on conflict.
func TestPositionsWrite_LatThenLng(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if got := len(rec.calls); got != 0 {
		t.Fatalf("after lat-only Write expected 0 db calls, got %d", got)
	}
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("after lng Write expected 1 db call, got %d", got)
	}
	call := rec.calls[0]
	assertPositionsCallShape(t, call)
	wantArgs := []any{posTestVIN, ts, float64(37.4), float64(-122.1), nil, nil}
	if !reflect.DeepEqual(call.Args, wantArgs) {
		t.Errorf("args=%v, want %v", call.Args, wantArgs)
	}
}

// TestWrite_LngThenLat is the symmetric case to the above — the codec
// emits children in proto-order which is currently lat=20 / lng=21,
// but the writer must be order-agnostic.
func TestPositionsWrite_LngThenLat(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng: %v", err)
	}
	if got := len(rec.calls); got != 0 {
		t.Fatalf("after lng-only Write expected 0 db calls, got %d", got)
	}
	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("after lat Write expected 1 db call, got %d", got)
	}
	wantArgs := []any{posTestVIN, ts, float64(37.4), float64(-122.1), nil, nil}
	if !reflect.DeepEqual(rec.calls[0].Args, wantArgs) {
		t.Errorf("args=%v, want %v", rec.calls[0].Args, wantArgs)
	}
}

// TestWrite_AllFourFieldsSamePayload simulates a single MQTT payload
// that carries all four routed signals for the same (vehicle, ts).
// The codec emits the children sequentially within the same
// Pipeline.Process invocation; the writer must coalesce them into a
// single INSERT that fires when the second of {lat, lng} arrives,
// and the heading + gps_state must already be in the buffered entry
// at flush time.
//
// This test exercises the case where heading and gps_state arrive
// BEFORE the lat/lng pair completes — a plausible ordering because
// in the proto schema GpsState=22 and GpsHeading=23 are AFTER
// Location=21 but AFTER unrelated fields can interleave.
func TestPositionsWrite_AllFourFieldsSamePayload(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	// heading + gps_state buffered first
	if err := w.Write(context.Background(), posAtom("GpsHeading", float32(180), ts), dstFor("GpsHeading", "heading_deg")); err != nil {
		t.Fatalf("Write heading: %v", err)
	}
	if err := w.Write(context.Background(), posAtom("GpsState", "valid", ts), dstFor("GpsState", "gps_state")); err != nil {
		t.Fatalf("Write gps_state: %v", err)
	}
	if got := len(rec.calls); got != 0 {
		t.Fatalf("after heading+gps Write expected 0 db calls, got %d", got)
	}

	// then the lat/lng pair completes
	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if got := len(rec.calls); got != 0 {
		t.Fatalf("after lat-only (still missing lng) expected 0 db calls, got %d", got)
	}
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("after final lng expected 1 db call, got %d", got)
	}

	wantArgs := []any{posTestVIN, ts, float64(37.4), float64(-122.1), float64(180), "valid"}
	if !reflect.DeepEqual(rec.calls[0].Args, wantArgs) {
		t.Errorf("args=%v, want %v", rec.calls[0].Args, wantArgs)
	}
}

// TestWrite_LateHeadingAfterFlushReFlushes verifies the keep-on-flush
// pattern: when GpsHeading arrives AFTER the lat/lng pair has already
// been flushed, the writer re-flushes the row via ON CONFLICT DO
// UPDATE so the heading is persisted. The COALESCE clauses guarantee
// the prior lat/lng are not wiped if EXCLUDED carries them again
// (they always do, because the buffered entry retains them).
func TestPositionsWrite_LateHeadingAfterFlushReFlushes(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	// initial pair flush
	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("after pair expected 1 db call, got %d", got)
	}

	// late heading triggers a re-flush
	if err := w.Write(context.Background(), posAtom("GpsHeading", float32(45), ts), dstFor("GpsHeading", "heading_deg")); err != nil {
		t.Fatalf("Write late heading: %v", err)
	}
	if got := len(rec.calls); got != 2 {
		t.Fatalf("after late heading expected 2 db calls, got %d", got)
	}
	wantArgs := []any{posTestVIN, ts, float64(37.4), float64(-122.1), float64(45), nil}
	if !reflect.DeepEqual(rec.calls[1].Args, wantArgs) {
		t.Errorf("late-heading args=%v, want %v", rec.calls[1].Args, wantArgs)
	}
}

// TestWrite_LateGpsStateAfterFlushReFlushes is the symmetric test for
// a late GpsState arrival.
func TestPositionsWrite_LateGpsStateAfterFlushReFlushes(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng: %v", err)
	}
	if err := w.Write(context.Background(), posAtom("GpsState", "valid", ts), dstFor("GpsState", "gps_state")); err != nil {
		t.Fatalf("Write late gps_state: %v", err)
	}
	if got := len(rec.calls); got != 2 {
		t.Fatalf("expected 2 db calls, got %d", got)
	}
	wantArgs := []any{posTestVIN, ts, float64(37.4), float64(-122.1), nil, "valid"}
	if !reflect.DeepEqual(rec.calls[1].Args, wantArgs) {
		t.Errorf("late-gps args=%v, want %v", rec.calls[1].Args, wantArgs)
	}
}

// TestWrite_MaxPendingExceeded verifies the hard memory ceiling. The
// 100_000 default is too large for a unit test so we shrink it.
func TestPositionsWrite_MaxPendingExceeded(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	w.maxPending = 2

	base := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	// Fill the buffer with two distinct (vin, ts) keys via lat-only writes.
	for i := 0; i < 2; i++ {
		ts := base.Add(time.Duration(i) * time.Second)
		if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(i), ts), dstFor("LocationLatitude", "lat")); err != nil {
			t.Fatalf("Write %d: %v", i, err)
		}
	}
	if got := len(w.pending); got != 2 {
		t.Fatalf("expected 2 pending entries, got %d", got)
	}

	// Third NEW key must error out.
	ts := base.Add(2 * time.Second)
	err := w.Write(context.Background(), posAtom("LocationLatitude", float64(2), ts), dstFor("LocationLatitude", "lat"))
	if err == nil {
		t.Fatal("expected error when buffer full, got nil")
	}
	if !strings.Contains(err.Error(), "pending buffer full") {
		t.Errorf("error does not mention buffer full: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "positionsWriter[positions]") {
		t.Errorf("error missing positions[positions] prefix: %q", err.Error())
	}

	// An update to an EXISTING key must still succeed (no map growth).
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(99), base), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("update of existing key after full: %v", err)
	}
}

// TestWrite_TTLEvictionDropsLoneEntries verifies that buffered half-
// pairs are evicted after pendingTTL elapses so a producer that stops
// emitting partners cannot grow the buffer unboundedly.
func TestPositionsWrite_TTLEvictionDropsLoneEntries(t *testing.T) {
	rec := &recorder{rows: 1}
	w, advance := newPositionsTestWriter(t, rec)
	w.pendingTTL = time.Minute
	w.evictionInterval = time.Second

	base := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	// Buffer a lat-only entry.
	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), base), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	if got := len(w.pending); got != 1 {
		t.Fatalf("expected 1 pending entry, got %d", got)
	}

	// Advance the clock past pendingTTL AND past evictionInterval.
	advance(2 * time.Minute)

	// Trigger the eviction sweep with an unrelated Write (a new key).
	ts2 := base.Add(time.Hour)
	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(40.0), ts2), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write second key: %v", err)
	}

	// The old entry must be gone; only the new one remains.
	if got := len(w.pending); got != 1 {
		t.Fatalf("expected 1 pending entry post-eviction, got %d", got)
	}
	for k := range w.pending {
		if k.ts.Equal(base) {
			t.Errorf("expected old key (ts=%s) to be evicted, but it remained", base)
		}
	}
}

// TestWrite_GpsHeadingFloat32AndFloat64 verifies the writer accepts
// both the codec's native float32 (from ftproto.Value_FloatValue) and
// a defensive float64 (in case a future protomodel change promotes
// the wire type). Both must promote to float64 for storage.
func TestPositionsWrite_GpsHeadingFloat32AndFloat64(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want float64
	}{
		{name: "float32", in: float32(45.5), want: 45.5},
		{name: "float64", in: float64(90.0), want: 90.0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w, _ := newPositionsTestWriter(t, rec)
			ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

			if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(1), ts), dstFor("LocationLatitude", "lat")); err != nil {
				t.Fatalf("Write lat: %v", err)
			}
			if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(2), ts), dstFor("LocationLongitude", "lng")); err != nil {
				t.Fatalf("Write lng: %v", err)
			}
			if err := w.Write(context.Background(), posAtom("GpsHeading", tc.in, ts), dstFor("GpsHeading", "heading_deg")); err != nil {
				t.Fatalf("Write heading: %v", err)
			}
			if got := len(rec.calls); got != 2 {
				t.Fatalf("expected 2 db calls, got %d", got)
			}
			gotHeading, ok := rec.calls[1].Args[4].(float64)
			if !ok {
				t.Fatalf("args[4] is not float64: %T", rec.calls[1].Args[4])
			}
			if gotHeading != tc.want {
				t.Errorf("heading=%v, want %v", gotHeading, tc.want)
			}
		})
	}
}

// TestWrite_TypeMismatchPerField asserts that a wrong runtime type for
// each routed Field returns an error AND does NOT mutate the buffer.
// The mutation guard is critical — a partial entry left behind would
// either leak memory (no flush trigger) or worse, flush partner
// values from a different payload onto a corrupt row.
func TestPositionsWrite_TypeMismatchPerField(t *testing.T) {
	cases := []struct {
		name      string
		field     string
		val       any
		wantError string
	}{
		{name: "lat not float64", field: "LocationLatitude", val: "37.4", wantError: "LocationLatitude: expected float64"},
		{name: "lng not float64", field: "LocationLongitude", val: int64(122), wantError: "LocationLongitude: expected float64"},
		{name: "heading not float", field: "GpsHeading", val: "north", wantError: "GpsHeading: expected float32 or float64"},
		{name: "gps_state not string", field: "GpsState", val: float64(0), wantError: "GpsState: expected string"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w, _ := newPositionsTestWriter(t, rec)
			ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
			err := w.Write(context.Background(), posAtom(tc.field, tc.val, ts), dstFor(tc.field, "ignored"))
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantError) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.wantError)
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected 0 db calls on type mismatch, got %d", got)
			}
			if got := len(w.pending); got != 0 {
				t.Errorf("expected 0 pending entries on type mismatch (no partial mutation), got %d", got)
			}
		})
	}
}

// TestWrite_UnroutedFieldErrorWording locks the exact error text as
// defence-in-depth for routing.yaml/positions_writer.go drift.
func TestPositionsWrite_UnroutedFieldErrorWording(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	err := w.Write(context.Background(), posAtom("UnknownField", float64(0), ts), dstFor("UnknownField", "ignored"))
	if err == nil {
		t.Fatal("expected error for unrouted field")
	}
	want := `positionsWriter: unrouted field "UnknownField"`
	if err.Error() != want {
		t.Errorf("error=%q, want %q", err.Error(), want)
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected 0 db calls for unrouted field, got %d", got)
	}
}

// TestWrite_RowsAffectedZeroIsVehicleNotRegistered verifies the VIN-
// resolution error path. The error message MUST NOT contain the VIN
// (PII) and MUST be wrapped with the positionsWriter[positions]
// prefix so the router's classifyError tagging works.
func TestPositionsWrite_RowsAffectedZeroIsVehicleNotRegistered(t *testing.T) {
	rec := &recorder{rows: 0} // simulate "INSERT 0 0" — no row inserted
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat: %v", err)
	}
	err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng"))
	if err == nil {
		t.Fatal("expected vehicle-not-registered error, got nil")
	}
	if !strings.Contains(err.Error(), "vehicle not registered") {
		t.Errorf("error does not mention vehicle not registered: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "positionsWriter[positions]") {
		t.Errorf("error missing positions writer prefix: %q", err.Error())
	}
	if strings.Contains(err.Error(), posTestVIN) {
		t.Errorf("error contains VIN (PII leak): %q", err.Error())
	}
}

// TestWrite_DBExecErrorWrapped verifies that a backend error is wrapped
// with the positionsWriter[positions] prefix AND that errors.Is can
// unwrap to the original sentinel.
func TestPositionsWrite_DBExecErrorWrapped(t *testing.T) {
	sentinel := errors.New("backend timed out")
	rec := &recorder{err: sentinel}
	w, _ := newPositionsTestWriter(t, rec)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat (buffered): %v", err)
	}
	err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng"))
	if err == nil {
		t.Fatal("expected wrapped backend error, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("errors.Is failed to unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "positionsWriter[positions]") {
		t.Errorf("error missing positions writer prefix: %q", err.Error())
	}
}

// TestWrite_DistinctTimestampsTwoRows simulates two payloads from the
// same vehicle at different timestamps. Each must produce its own
// INSERT — the buffer must not collapse them.
func TestPositionsWrite_DistinctTimestampsTwoRows(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)
	ts1 := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	ts2 := ts1.Add(time.Second)

	for _, ts := range []time.Time{ts1, ts2} {
		if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), ts), dstFor("LocationLatitude", "lat")); err != nil {
			t.Fatalf("Write lat ts=%s: %v", ts, err)
		}
		if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), ts), dstFor("LocationLongitude", "lng")); err != nil {
			t.Fatalf("Write lng ts=%s: %v", ts, err)
		}
	}

	if got := len(rec.calls); got != 2 {
		t.Fatalf("expected 2 db calls (one per ts), got %d", got)
	}
	if !rec.calls[0].Args[1].(time.Time).Equal(ts1) {
		t.Errorf("call[0] ts=%v, want %v", rec.calls[0].Args[1], ts1)
	}
	if !rec.calls[1].Args[1].(time.Time).Equal(ts2) {
		t.Errorf("call[1] ts=%v, want %v", rec.calls[1].Args[1], ts2)
	}
}

// TestWrite_TimestampNormalisationStripsLocation verifies that two
// atomics carrying the same wall-clock instant in different
// time.Locations resolve to the same map key. Without normalisation
// (UTC + Round(0)) a non-UTC EmittedAt would create a duplicate key
// and the partner would never pair-up.
func TestPositionsWrite_TimestampNormalisationStripsLocation(t *testing.T) {
	rec := &recorder{rows: 1}
	w, _ := newPositionsTestWriter(t, rec)

	utc := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}
	la := utc.In(loc) // same instant, different Location

	if err := w.Write(context.Background(), posAtom("LocationLatitude", float64(37.4), utc), dstFor("LocationLatitude", "lat")); err != nil {
		t.Fatalf("Write lat utc: %v", err)
	}
	if err := w.Write(context.Background(), posAtom("LocationLongitude", float64(-122.1), la), dstFor("LocationLongitude", "lng")); err != nil {
		t.Fatalf("Write lng la: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("expected 1 db call when same instant in different Locations pair up, got %d", got)
	}
}

// TestWrite_ConcurrentWritesNoRace stresses the mutex by firing many
// concurrent Write calls from independent goroutines. With -race this
// catches any unguarded access to the pending map.
func TestPositionsWrite_ConcurrentWritesNoRace(t *testing.T) {
	rec := newConcurrentRecorder()
	w := newPositionsWriter(rec)
	w.now = time.Now // real clock is fine for concurrency stress

	const goroutines = 16
	const perRoutine = 50
	base := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(off int) {
			defer wg.Done()
			for i := 0; i < perRoutine; i++ {
				ts := base.Add(time.Duration(off*perRoutine+i) * time.Millisecond)
				_ = w.Write(context.Background(), posAtom("LocationLatitude", float64(off), ts), dstFor("LocationLatitude", "lat"))
				_ = w.Write(context.Background(), posAtom("LocationLongitude", float64(i), ts), dstFor("LocationLongitude", "lng"))
			}
		}(g)
	}
	wg.Wait()

	if got := rec.count(); got != goroutines*perRoutine {
		t.Errorf("expected %d db calls (one per (g, i) ts), got %d", goroutines*perRoutine, got)
	}
}

// concurrentRecorder is a thread-safe pgxPool fake used only by the
// concurrent stress test. The package's stock recorder fake is
// single-threaded, so this in-file variant adds a Mutex without
// introducing shared test infrastructure.
type concurrentRecorder struct {
	mu    sync.Mutex
	rows  int64
	calls int64
}

func newConcurrentRecorder() *concurrentRecorder {
	return &concurrentRecorder{rows: 1}
}

func (r *concurrentRecorder) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	atomic.AddInt64(&r.calls, 1)
	return pgconn.NewCommandTag(fmt.Sprintf("INSERT 0 %d", r.rows)), nil
}

func (r *concurrentRecorder) count() int {
	return int(atomic.LoadInt64(&r.calls))
}
