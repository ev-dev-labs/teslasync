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

// newClimateTestWriter wires a snapshotWriter against the recording
// fake from snapshot_base_test.go (same package) using the production
// climate columnFor. We deliberately build the snapshotWriter directly
// rather than going through NewClimateWriter because the public
// constructor takes a *pgxpool.Pool and the recorder is the smaller
// pgxPool interface — same seam pattern as positions_writer_test.go.
func newClimateTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "climate_snapshots", climateColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for climate: %v", err)
	}
	return w
}

// TestClimateWriter_ColumnMapMatchesRoutingYAML is the reflective
// coverage gate from phase-42a prompt 0012 Decision #4. It walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestClimateSnapshot, and asserts the
// climateColumnByField map in climate_writer.go matches the routing
// layer entry-for-entry — same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a climate_snapshot route but climate_writer.go
//     does not — Write would return "no column mapping for field" at
//     runtime, the test fails with "missing field".
//
//   - climate_writer.go adds an entry that routing.yaml does not — the
//     entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     climate_writer.go — Write would target the wrong column at
//     runtime (or fail safeIdentRE), the test fails with mismatched
//     column.
func TestClimateWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestClimateSnapshot {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 31; got != want {
		t.Errorf("routing.yaml has %d climate_snapshot entries, expected %d "+
			"(prompt 0012 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(climateColumnByField), len(expected); got != want {
		t.Errorf("climateColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := climateColumnByField[field]
		if !ok {
			t.Errorf("climateColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("climateColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range climateColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("climateColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: climate_snapshot)",
				field, gotCol)
		}
	}
}

// TestClimateWriter_TypeMatrix exercises one positive write per kind
// from phase-42a prompt 0012 Decision #5(b): float64, bool, text. We
// pick representative routed fields so the map lookup AND the
// snapshotWriter SQL composition are both covered:
//
//   - float64 → InsideTemp → inside_temp_c (DOUBLE PRECISION column)
//   - bool    → HvacACEnabled → hvac_ac_enabled (BOOLEAN column)
//   - text    → DefrostMode → defrost_mode (TEXT column)
//
// We additionally include int64 → HvacFanSpeed → hvac_fan_speed
// (INTEGER column) because climate_snapshots has nine INTEGER columns
// and the codec emits them as int64. The prompt's wording "one per
// kind" sets a floor, not a ceiling.
//
// Each case asserts that the SQL contains the climate_snapshots table
// identifier and the expected column identifier (both pgx.Identifier-
// quoted), that the bound $3 argument is the bare value (no coercion),
// and that exactly one Exec call was made.
func TestClimateWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000042"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name  string
		field string
		col   string
		val   any
	}{
		{name: "float64_InsideTemp", field: "InsideTemp", col: "inside_temp_c", val: float64(22.5)},
		{name: "int64_HvacFanSpeed", field: "HvacFanSpeed", col: "hvac_fan_speed", val: int64(7)},
		{name: "bool_HvacACEnabled", field: "HvacACEnabled", col: "hvac_ac_enabled", val: true},
		{name: "text_DefrostMode", field: "DefrostMode", col: "defrost_mode", val: "auto"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newClimateTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestClimateSnapshot,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "climate_snapshots", tc.col)
			wantArgs := []any{vin, ts, tc.val}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestClimateWriter_UnknownFieldReturnsError covers phase-42a prompt
// 0012 Decision #5(c): a Field that is NOT routed to climate_snapshot
// must produce a "no column mapping" error and MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the climate map to swallow
// non-climate fields.
func TestClimateWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newClimateTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestClimateSnapshot,
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
	if !strings.Contains(err.Error(), "climate_snapshots") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestNewClimateWriter_NilPoolPanics locks the constructor's
// fail-fast contract from phase-42a prompt 0012 Decision #1. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewClimateWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewClimateWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewClimateWriter(nil)
}
