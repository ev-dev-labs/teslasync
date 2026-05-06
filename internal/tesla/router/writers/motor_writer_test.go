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

// newMotorTestWriter wires a snapshotWriter against the recording
// fake from snapshot_base_test.go (same package) using the production
// motor columnFor. We deliberately build the snapshotWriter directly
// rather than going through NewMotorWriter because the public
// constructor takes a *pgxpool.Pool and the recorder is the smaller
// pgxPool interface — same seam pattern as climate_writer_test.go.
func newMotorTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "motor_snapshots", motorColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for motor: %v", err)
	}
	return w
}

// TestMotorWriter_ColumnMapMatchesRoutingYAML is the reflective
// coverage gate from phase-42a prompt 0013 Decision #4. It walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestMotorSnapshot, and asserts the
// motorColumnByField map in motor_writer.go matches the routing
// layer entry-for-entry — same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a motor_snapshot route but motor_writer.go
//     does not — Write would return "no column mapping for field" at
//     runtime, the test fails with "missing field".
//
//   - motor_writer.go adds an entry that routing.yaml does not — the
//     entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     motor_writer.go — Write would target the wrong column at
//     runtime (or fail safeIdentRE), the test fails with mismatched
//     column.
func TestMotorWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestMotorSnapshot {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 36; got != want {
		t.Errorf("routing.yaml has %d motor_snapshot entries, expected %d "+
			"(prompt 0013 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(motorColumnByField), len(expected); got != want {
		t.Errorf("motorColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := motorColumnByField[field]
		if !ok {
			t.Errorf("motorColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("motorColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range motorColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("motorColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: motor_snapshot)",
				field, gotCol)
		}
	}
}

// TestMotorWriter_TypeMatrix exercises one positive write per kind
// from phase-42a prompt 0013 Decision #5(b). The motor_snapshots
// schema (migration 000183 lines 125-166) has only TWO scalar kinds:
// 33 DOUBLE PRECISION columns (covered by float64 atomics) and 5 TEXT
// columns (covered by string atomics). There are NO BOOLEAN or
// INTEGER columns — bool/int64 cases are intentionally omitted
// because no routed motor field can carry them; including such a
// case would only exercise snapshot_base.go's bindSnapshotValue
// (already covered by snapshot_base_test.go's TestWrite_*) and would
// not represent a producer/codec contract that motor_writer
// participates in.
//
// Representative routed fields:
//
//   - float64 → DiTorqueActualF → front_torque_nm (DOUBLE PRECISION)
//   - text    → DiStateF        → front_state    (TEXT)
//
// Each case asserts that the SQL contains the motor_snapshots table
// identifier and the expected column identifier (both pgx.Identifier-
// quoted), that the bound $3 argument is the bare value (no coercion),
// and that exactly one Exec call was made.
func TestMotorWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000042"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name  string
		field string
		col   string
		val   any
	}{
		{name: "float64_DiTorqueActualF", field: "DiTorqueActualF", col: "front_torque_nm", val: float64(425.75)},
		{name: "text_DiStateF", field: "DiStateF", col: "front_state", val: "DRIVE_ENABLED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newMotorTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestMotorSnapshot,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "motor_snapshots", tc.col)
			wantArgs := []any{vin, ts, tc.val}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestMotorWriter_UnknownFieldReturnsError covers phase-42a prompt
// 0013 Decision #5(c): a Field that is NOT routed to motor_snapshot
// must produce a "no column mapping" error and MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the motor map to swallow
// non-motor fields.
func TestMotorWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newMotorTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestMotorSnapshot,
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
	if !strings.Contains(err.Error(), "motor_snapshots") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestNewMotorWriter_NilPoolPanics locks the constructor's
// fail-fast contract from phase-42a prompt 0013 Decision #1. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewMotorWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewMotorWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewMotorWriter(nil)
}
