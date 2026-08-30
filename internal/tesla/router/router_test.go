package router

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// TestEmbeddedRoutingIsLoadable verifies the embedded routing.yaml
// parses cleanly and that LoadMap and Load agree on the entry count.
//
// The invariant is that the loader succeeds and Load/LoadMap agree. The
// reflective coverage test enforces per-category coverage from the
// protomodel side.
func TestEmbeddedRoutingIsLoadable(t *testing.T) {
	entries, err := Load()
	if err != nil {
		t.Fatalf("Load returned unexpected error: %v", err)
	}

	m, err := LoadMap()
	if err != nil {
		t.Fatalf("LoadMap returned unexpected error: %v", err)
	}
	if got, want := len(m), len(entries); got != want {
		t.Fatalf("LoadMap: map has %d entries, Load has %d (loader disagreement)", got, want)
	}
}

// TestRouterRejectsUnknownField verifies Route returns ErrNoRoute
// (wrapped via fmt.Errorf %w) for any Field not present in
// routing.yaml. The test stands up a Router with a nopWriter for
// every destination currently referenced by the embedded routing.yaml
// so that New() succeeds as routes are added, then asserts an unrouted Field still
// fails LOUDLY.
//
// The probe Field is a fixed sentinel that intentionally has no
// proto counterpart, so this test stays valid as more category
// prompts land additional routes.
func TestRouterRejectsUnknownField(t *testing.T) {
	const sentinelField = "RouterTestUnknownFieldSentinel"

	entries, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	writers := map[Destination]Writer{}
	for _, e := range entries {
		if e.Destination == DestDrop {
			continue
		}
		if _, ok := writers[e.Destination]; !ok {
			writers[e.Destination] = nopWriter{}
		}
	}

	r, err := New(writers)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = r.Route(context.Background(), codec.Atomic{Field: sentinelField})
	if err == nil {
		t.Fatal("Route: expected error for unknown Field, got nil")
	}
	if !errors.Is(err, ErrNoRoute) {
		t.Fatalf("Route: expected error to wrap ErrNoRoute, got %v", err)
	}
	if !strings.Contains(err.Error(), sentinelField) {
		t.Fatalf("Route: expected error to mention offending Field name, got %q", err.Error())
	}
}

// TestLoaderRejectsDuplicateField verifies the validator catches a
// routing.yaml that lists the same Field twice. The validator runs
// at process startup, not at dispatch time, so a duplicate entry is
// a fail-fast deployment error rather than a silent ambiguity at
// Route time.
//
// This is the structural enforcement of ADR-004's "every Field has
// exactly one routing entry" invariant from the loader side; the
// reflective coverage test enforces it from the codegen side.
func TestLoaderRejectsDuplicateField(t *testing.T) {
	yaml := []byte(`routes:
  - field: VehicleSpeed
    dest: positions
    column: speed_mps
  - field: VehicleSpeed
    dest: drive_telemetry
    column: speed
`)
	_, err := loadFrom(yaml)
	if err == nil {
		t.Fatal("loadFrom: expected duplicate-field error, got nil")
	}
	msg := err.Error()
	if !strings.Contains(msg, "duplicate") {
		t.Fatalf("loadFrom: error %q does not mention `duplicate`", msg)
	}
	if !strings.Contains(msg, "VehicleSpeed") {
		t.Fatalf("loadFrom: error %q does not name the offending Field", msg)
	}
}

// TestLoaderRejectsUnknownDestination verifies the validator rejects
// a routing.yaml that names a destination outside the closed
// validDestinations set in routing_loader.go.
//
// Without this check a typo (e.g. "positons" instead of "positions")
// would silently drop every atomic for that Field forever, because
// the destination would not match any registered writer and the
// router would either return ErrNoRoute or — worse — dispatch to a
// later-registered writer of the same misspelled name. Failing at
// Load time turns the typo into a startup crash with a precise
// error message.
func TestLoaderRejectsUnknownDestination(t *testing.T) {
	yaml := []byte(`routes:
  - field: VehicleSpeed
    dest: not_a_table
    column: speed_mps
`)
	_, err := loadFrom(yaml)
	if err == nil {
		t.Fatal("loadFrom: expected unknown-destination error, got nil")
	}
	if !strings.Contains(err.Error(), "not_a_table") {
		t.Fatalf("loadFrom: error %q does not mention the unknown destination", err.Error())
	}
}

// TestNewRejectsWriterForUnknownDestination verifies New refuses a
// writers map keyed by a Destination that is not in the closed set.
// This catches typos at the call site (normalize.Pipeline wiring)
// rather than letting them silently no-op forever.
func TestNewRejectsWriterForUnknownDestination(t *testing.T) {
	_, err := New(map[Destination]Writer{
		Destination("positons"): nopWriter{},
	})
	if err == nil {
		t.Fatal("New: expected error for typo in writers map key, got nil")
	}
	if !strings.Contains(err.Error(), "positons") {
		t.Fatalf("New: error %q does not name the offending destination key", err.Error())
	}
}

// nopWriter is a stand-in Writer used only by TestNewRejectsWriter*
// to populate the writers map with a non-nil value. Route is never
// called against it because New errors out before any dispatch.
type nopWriter struct{}

func (nopWriter) Write(ctx context.Context, atomic codec.Atomic, dst Entry) error {
	return nil
}

type recordingBatchWriter struct {
	mu          sync.Mutex
	singleCalls int
	batches     [][]RoutedAtomic
	batchErrors []error
}

func (w *recordingBatchWriter) Write(context.Context, codec.Atomic, Entry) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.singleCalls++
	return nil
}

func (w *recordingBatchWriter) WriteBatch(_ context.Context, items []RoutedAtomic) []error {
	w.mu.Lock()
	defer w.mu.Unlock()
	cp := make([]RoutedAtomic, len(items))
	copy(cp, items)
	w.batches = append(w.batches, cp)
	if w.batchErrors != nil {
		return w.batchErrors
	}
	return make([]error, len(items))
}

func TestRouteBatch_UsesBatchWritersAndPreservesDualLog(t *testing.T) {
	primary := &recordingBatchWriter{}
	signalLog := &recordingBatchWriter{}
	r := &Router{
		entries: map[string]Entry{
			"InsideTemp": {
				Field:       "InsideTemp",
				Destination: DestClimateSnapshot,
				Column:      "inside_temp_c",
			},
			"OutsideTemp": {
				Field:       "OutsideTemp",
				Destination: DestClimateSnapshot,
				Column:      "outside_temp_c",
			},
		},
		writers: map[Destination]Writer{
			DestClimateSnapshot: primary,
			DestSignalLog:       signalLog,
		},
	}

	results, err := r.RouteBatch(context.Background(), []codec.Atomic{
		{Field: "InsideTemp"},
		{Field: "OutsideTemp"},
	})
	if err != nil {
		t.Fatalf("RouteBatch: %v", err)
	}
	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("results = %#v, want two nil entries", results)
	}
	primaryBatchSize := 0
	if len(primary.batches) == 1 {
		primaryBatchSize = len(primary.batches[0])
	}
	if primary.singleCalls != 0 || len(primary.batches) != 1 || primaryBatchSize != 2 {
		t.Fatalf(
			"primary calls: singles=%d batches=%d batch size=%d, want 0/1/2",
			primary.singleCalls,
			len(primary.batches),
			primaryBatchSize,
		)
	}
	signalLogBatchSize := 0
	if len(signalLog.batches) == 1 {
		signalLogBatchSize = len(signalLog.batches[0])
	}
	if signalLog.singleCalls != 0 || len(signalLog.batches) != 1 || signalLogBatchSize != 2 {
		t.Fatalf(
			"signal_log calls: singles=%d batches=%d batch size=%d, want 0/1/2",
			signalLog.singleCalls,
			len(signalLog.batches),
			signalLogBatchSize,
		)
	}
	for _, item := range signalLog.batches[0] {
		if item.Entry.Destination != DestSignalLog {
			t.Errorf("dual destination = %q, want %q", item.Entry.Destination, DestSignalLog)
		}
	}
}

func TestRouteBatch_PreservesPerItemPrimaryFailures(t *testing.T) {
	sentinel := errors.New("write failed")
	primary := &recordingBatchWriter{batchErrors: []error{nil, sentinel}}
	signalLog := &recordingBatchWriter{}
	r := &Router{
		entries: map[string]Entry{
			"InsideTemp": {
				Field:       "InsideTemp",
				Destination: DestClimateSnapshot,
				Column:      "inside_temp_c",
			},
			"OutsideTemp": {
				Field:       "OutsideTemp",
				Destination: DestClimateSnapshot,
				Column:      "outside_temp_c",
			},
		},
		writers: map[Destination]Writer{
			DestClimateSnapshot: primary,
			DestSignalLog:       signalLog,
		},
	}

	results, err := r.RouteBatch(context.Background(), []codec.Atomic{
		{Field: "InsideTemp"},
		{Field: "OutsideTemp"},
	})
	if err != nil {
		t.Fatalf("RouteBatch: %v", err)
	}
	if len(results) != 2 || results[0] != nil || !errors.Is(results[1], sentinel) {
		t.Fatalf("results = %#v, want [nil, sentinel]", results)
	}
	if len(signalLog.batches) != 1 || len(signalLog.batches[0]) != 2 {
		t.Fatalf("signal_log batches = %#v, want both atomics despite primary failure", signalLog.batches)
	}
}

func TestWriteBatch_RejectsMisalignedBatchWriterResults(t *testing.T) {
	writer := &recordingBatchWriter{batchErrors: []error{nil}}
	results := writeBatch(context.Background(), writer, []RoutedAtomic{
		{Atomic: codec.Atomic{Field: "InsideTemp"}},
		{Atomic: codec.Atomic{Field: "OutsideTemp"}},
	})
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2", len(results))
	}
	for i, err := range results {
		if err == nil || !strings.Contains(err.Error(), "returned 1 results for 2 items") {
			t.Errorf("results[%d] = %v, want result-count error", i, err)
		}
	}
}
