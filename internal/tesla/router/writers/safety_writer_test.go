package writers

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newSafetyTestWriter wires a snapshotWriter against the recording
// fake from snapshot_base_test.go (same package) using the production
// safety columnFor. We deliberately build the snapshotWriter directly
// rather than going through NewSafetyWriter because the public
// constructor takes a *pgxpool.Pool and the recorder is the smaller
// pgxPool interface — same seam pattern as climate_writer_test.go and
// media_writer_test.go.
func newSafetyTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "safety_snapshots", safetyColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for safety: %v", err)
	}
	return w
}

// TestSafetyWriter_ColumnMapMatchesRoutingYAML is the reflective
// coverage gate from phase-42a prompt 0016 Decision #4. It walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestSafetySnapshot, and asserts the
// safetyColumnByField map in safety_writer.go matches the routing
// layer entry-for-entry — same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a safety_snapshot route but safety_writer.go
//     does not — Write would return "no column mapping for field" at
//     runtime, the test fails with "missing field".
//
//   - safety_writer.go adds an entry that routing.yaml does not — the
//     entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     safety_writer.go — Write would target the wrong column at
//     runtime (or fail safeIdentRE), the test fails with mismatched
//     column.
func TestSafetyWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestSafetySnapshot {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 1; got != want {
		t.Errorf("routing.yaml has %d safety_snapshot entries, expected %d "+
			"(prompt 0016 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(safetyColumnByField), len(expected); got != want {
		t.Errorf("safetyColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := safetyColumnByField[field]
		if !ok {
			t.Errorf("safetyColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("safetyColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range safetyColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("safetyColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: safety_snapshot)",
				field, gotCol)
		}
	}
}

// TestSafetyWriter_TypeMatrix exercises the single routed field
// today per phase-42a prompt 0016 Decision #5: ServiceMode →
// service_mode (BOOLEAN column per migration 000183 line 312). The
// codec emits BoolValue payloads as bool, so the snapshotWriter's
// bindSnapshotValue path through the bool case is the production
// hot path.
//
// Once additional safety_snapshot routes land (the table reserves
// service_mode_plus BOOLEAN, wiper_state TEXT, crash_state TEXT —
// see migration 000183 lines 309-317), this matrix should grow to
// cover every column kind in use.
//
// The case asserts that the SQL contains the safety_snapshots table
// identifier and the expected column identifier (both pgx.Identifier-
// quoted), that the bound $3 argument is the bare value (no
// coercion), and that exactly one Exec call was made.
func TestSafetyWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000042"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name  string
		field string
		col   string
		val   any
	}{
		{name: "bool_ServiceMode", field: "ServiceMode", col: "service_mode", val: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newSafetyTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestSafetySnapshot,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "safety_snapshots", tc.col)
			wantArgs := []any{vin, ts, tc.val}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestSafetyWriter_UnknownFieldReturnsError covers phase-42a prompt
// 0016 Decision #5: a Field that is NOT routed to safety_snapshot
// must produce a "no column mapping" error and MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the safety map to swallow
// non-safety fields.
func TestSafetyWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newSafetyTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestSafetySnapshot,
	})
	if err == nil {
		t.Fatal("expected error for unrouted field, got nil")
	}
	if !strings.Contains(err.Error(), "no column mapping for field") {
		t.Errorf("error does not mention missing mapping: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "VehicleSpeed") {
		t.Errorf("error does not name the offending field: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "safety_snapshots") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestNewSafetyWriter_NilPoolPanics locks the constructor's
// fail-fast contract from phase-42a prompt 0016 Decision #1. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewSafetyWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewSafetyWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewSafetyWriter(nil)
}
