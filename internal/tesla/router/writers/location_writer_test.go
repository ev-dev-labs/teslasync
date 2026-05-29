package writers

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newLocationTestWriter wires a snapshotWriter against the recording
// fake from snapshot_base_test.go (same package) using the production
// location columnFor. We deliberately build the snapshotWriter directly
// rather than going through NewLocationWriter because the public
// constructor takes a *pgxpool.Pool and the recorder is the smaller
// pgxPool interface — same seam pattern as safety_writer_test.go and
// media_writer_test.go.
func newLocationTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "location_snapshots", locationColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for location: %v", err)
	}
	return w
}

// TestLocationWriter_ColumnMapMatchesRoutingYAML is the reflective
// coverage gate. It walks router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestLocationSnapshot, and asserts the
// locationColumnByField map in location_writer.go matches the routing
// layer entry-for-entry — same field set, same column for each field.
//
// There are currently ZERO routes for dest: location_snapshot
// (the location_snapshots table is populated by the geocoding worker on
// a separate write path, NOT by telemetry atomics). The empty case is
// the expected outcome today; the assertion will fail the moment a
// future routing.yaml entry adds a location_snapshot route without a
// matching locationColumnByField entry, which is the intended drift
// gate.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a location_snapshot route but location_writer.go
//     does not — Write would return "no column mapping for field" at
//     runtime, the test fails with "missing field".
//
//   - location_writer.go adds an entry that routing.yaml does not — the
//     entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     location_writer.go — Write would target the wrong column at
//     runtime (or fail safeIdentRE), the test fails with mismatched
//     column.
func TestLocationWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestLocationSnapshot {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 0; got != want {
		t.Errorf("routing.yaml has %d location_snapshot entries, expected %d "+
			"(prompt 0017 baseline; if the count legitimately changed update both this assertion and the writer map "+
			"— and read the TIMESTAMPTZ caveat in location_writer.go's locationColumnByField godoc before routing geocoded_at)",
			got, want)
	}

	if got, want := len(locationColumnByField), len(expected); got != want {
		t.Errorf("locationColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := locationColumnByField[field]
		if !ok {
			t.Errorf("locationColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("locationColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range locationColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("locationColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: location_snapshot)",
				field, gotCol)
		}
	}
}

// TestLocationWriter_EmptyMapConstructsSuccessfully covers the empty-case
// clause: with zero routes today
// the writer constructor must still return successfully so the router
// can wire one writer per Destination const
// without panicking on "no writer for destination location_snapshot".
//
// We exercise the unexported newSnapshotWriter (with a recorder pool)
// rather than NewLocationWriter so the test stays in the writers
// package and doesn't need to fabricate a *pgxpool.Pool — the public
// constructor's nil-pool fail-fast is locked by
// TestNewLocationWriter_NilPoolPanics below.
func TestLocationWriter_EmptyMapConstructsSuccessfully(t *testing.T) {
	rec := &recorder{}
	w, err := newSnapshotWriter(rec, "location_snapshots", locationColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter rejected the empty location columnFor: %v", err)
	}
	if w == nil {
		t.Fatal("newSnapshotWriter returned (nil, nil) for the empty location columnFor")
	}
	// The router.Writer interface satisfaction is asserted at
	// compile-time by snapshot_base.go's `var _ router.Writer =
	// (*snapshotWriter)(nil)` — confirm here that the value
	// produced by the location wiring is the same concrete type.
	var _ router.Writer = w
}

// TestLocationWriter_AnyFieldReturnsError covers the empty-map contract:
// with the columnFor map empty today, EVERY Field
// must produce a "no column mapping" error and MUST NOT touch the DB.
// This is the empty-map analogue of the other writers'
// UnknownFieldReturnsError test.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the location map to swallow
// non-location fields. The "Place" name is included as a forward-
// looking guard: when geocoder routes finally land they may carry
// canonical names like Place / Country / Region, and this case will
// keep failing until the routing.yaml entry + locationColumnByField
// entry land together.
func TestLocationWriter_AnyFieldReturnsError(t *testing.T) {
	cases := []struct {
		name  string
		field string
		val   any
	}{
		{name: "VehicleSpeed_routed_elsewhere", field: "VehicleSpeed", val: float64(60)},
		{name: "Place_future_geocoder_field", field: "Place", val: "Home"},
		{name: "GeocodedAt_future_timestamptz", field: "GeocodedAt", val: int64(1730000000)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newLocationTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestLocationSnapshot,
			})
			if err == nil {
				t.Fatal("expected error for field with no column mapping, got nil")
			}
			if !strings.Contains(err.Error(), "no column mapping for field") {
				t.Errorf("error does not mention missing mapping: %q", err.Error())
			}
			if !strings.Contains(err.Error(), tc.field) {
				t.Errorf("error does not name the offending field: %q", err.Error())
			}
			if !strings.Contains(err.Error(), "location_snapshots") {
				t.Errorf("error does not name the destination table: %q", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
			}
		})
	}
}

// TestNewLocationWriter_NilPoolPanics locks the constructor's
// fail-fast contract. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewLocationWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewLocationWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewLocationWriter(nil)
}
