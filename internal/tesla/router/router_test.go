package router

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// TestEmptyRoutingIsLoadable verifies the embedded routing.yaml as it
// ships in this prompt parses cleanly and produces zero entries.
//
// The point of this test is to lock the empty-file contract for
// per-category prompts 0030-0037: those prompts should be able to
// add entries one at a time, run their own gates, and trust that
// the loader was already proven correct against an empty file.
// Skipping this assertion would let a regression in the parser
// (e.g. requiring at least one entry) hide until the first category
// prompt runs.
func TestEmptyRoutingIsLoadable(t *testing.T) {
	entries, err := Load()
	if err != nil {
		t.Fatalf("Load returned unexpected error: %v", err)
	}
	if got := len(entries); got != 0 {
		t.Fatalf("Load: expected 0 entries (routing.yaml ships empty in prompt 0025), got %d: %+v", got, entries)
	}

	m, err := LoadMap()
	if err != nil {
		t.Fatalf("LoadMap returned unexpected error: %v", err)
	}
	if got := len(m); got != 0 {
		t.Fatalf("LoadMap: expected empty map, got %d entries", got)
	}
}

// TestRouterRejectsUnknownField verifies Route returns ErrNoRoute
// (wrapped via fmt.Errorf %w) for any Field not present in
// routing.yaml. Because routing.yaml is empty in this prompt, every
// Field is unknown, so this test doubles as the lower-bound
// guarantee: an empty routing.yaml + a non-empty stream means the
// router fails LOUDLY for every value rather than silently dropping.
func TestRouterRejectsUnknownField(t *testing.T) {
	r, err := New(nil)
	if err != nil {
		t.Fatalf("New(nil): %v", err)
	}
	err = r.Route(context.Background(), codec.Atomic{Field: "VehicleSpeed"})
	if err == nil {
		t.Fatal("Route: expected error for unknown Field, got nil")
	}
	if !errors.Is(err, ErrNoRoute) {
		t.Fatalf("Route: expected error to wrap ErrNoRoute, got %v", err)
	}
	if !strings.Contains(err.Error(), "VehicleSpeed") {
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
// reflective coverage test in prompt 0038 enforces it from the
// codegen side.
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
