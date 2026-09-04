package writers

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newDriveTelemetryTestWriter wires a *driveTelemetryWriter against
// the recording fake from snapshot_base_test.go (same package) using
// the production drive_telemetry columnFor. We deliberately build
// the writer directly rather than going through
// NewDriveTelemetryWriter because the public constructor takes a
// *pgxpool.Pool and the recorder is the smaller pgxPool interface —
// same seam pattern as charging_telemetry_writer_test.go and
// tire_pressure_writer_test.go.
func newDriveTelemetryTestWriter(t *testing.T, rec *recorder) *driveTelemetryWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "drive_telemetry", driveTelemetryColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for drive_telemetry: %v", err)
	}
	return &driveTelemetryWriter{snap: w}
}

// TestDriveTelemetryWriter_ColumnMapMatchesRoutingYAML is the
// reflective coverage gate for drive_telemetry routing.
// It walks router.LoadMap() (which parses the embedded routing.yaml),
// filters to entries with Destination == DestDriveTelemetry, and
// asserts the driveTelemetryColumnByField map in
// drive_telemetry_writer.go matches the routing layer entry-for-entry —
// same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a drive_telemetry route but
//     drive_telemetry_writer.go does not — Write would return
//     "no column mapping for field" at runtime, the test fails with
//     "missing field".
//
//   - drive_telemetry_writer.go adds an entry that routing.yaml does
//     not — the entry is dead code, the test fails with "extra
//     field".
//
//   - the column name in routing.yaml drifts from the column name in
//     drive_telemetry_writer.go — Write would target the wrong column
//     at runtime (or fail safeIdentRE), the test fails with
//     mismatched column.
func TestDriveTelemetryWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestDriveTelemetry {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 11; got != want {
		t.Errorf("routing.yaml has %d drive_telemetry entries, expected %d "+
			"(prompt 0020 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(driveTelemetryColumnByField), len(expected); got != want {
		t.Errorf("driveTelemetryColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := driveTelemetryColumnByField[field]
		if !ok {
			t.Errorf("driveTelemetryColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("driveTelemetryColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range driveTelemetryColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("driveTelemetryColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: drive_telemetry)",
				field, gotCol)
		}
	}
}

// TestDriveTelemetryWriter_EnumFieldsMatchProtomodel cross-checks the
// driveTelemetryEnumFields dispatch set against the authoritative
// protomodel.SignalsByName metadata. Every Field that is (a) routed
// to drive_telemetry AND (b) declared with ValueKind == ValueKindEnum
// in protomodel must appear in driveTelemetryEnumFields, and vice
// versa.
//
// This catches two drift classes:
//
//   - routing.yaml routes a NEW enum-typed field to drive_telemetry
//     and the writer's dispatch set was not updated — Write would
//     return snapshot_base.bindSnapshotValue's "unsupported value
//     type" at runtime because the typed enum bypasses the
//     coerceProtoEnumToText branch. The test fails with "missing
//     enum field".
//
//   - driveTelemetryEnumFields lists a field that protomodel does
//     not classify as ValueKindEnum — the dispatch is dead code or
//     mis-categorising a non-enum field. The test fails with "extra
//     enum field".
func TestDriveTelemetryWriter_EnumFieldsMatchProtomodel(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]struct{}{}
	for field, e := range m {
		if e.Destination != router.DestDriveTelemetry {
			continue
		}
		meta, ok := protomodel.SignalsByName[field]
		if !ok {
			t.Errorf("routing.yaml routes field %q to drive_telemetry but it is absent from protomodel.SignalsByName",
				field)
			continue
		}
		if meta.ValueKind == protomodel.ValueKindEnum {
			expected[field] = struct{}{}
		}
	}

	for field := range expected {
		if _, ok := driveTelemetryEnumFields[field]; !ok {
			t.Errorf("driveTelemetryEnumFields missing field %q (protomodel ValueKind=Enum, routed to drive_telemetry)",
				field)
		}
	}
	for field := range driveTelemetryEnumFields {
		if _, ok := expected[field]; !ok {
			t.Errorf("driveTelemetryEnumFields has extra field %q "+
				"(not declared as ValueKindEnum + routed to drive_telemetry in protomodel/routing.yaml)",
				field)
		}
	}

	// Today the only routed enum is Gear → ShiftState. Pin the
	// baseline so a silent drift in protomodel that flips Gear's
	// ValueKind to Float (e.g. a regenerator regression) is caught
	// even if the symmetric checks above happen to balance.
	if _, ok := driveTelemetryEnumFields["Gear"]; !ok {
		t.Errorf("driveTelemetryEnumFields missing Gear (prompt 0020 baseline)")
	}
}

// TestDriveTelemetryWriter_TypeMatrix exercises one positive write per
// supported kind: float64, bool,
// and the proto-enum-via-Stringer path that drives the gear column.
// We pick representative routed fields so the map lookup AND the
// snapshotWriter SQL composition are both covered:
//
//   - float64 → VehicleSpeed → speed_mps (DOUBLE PRECISION column)
//   - bool    → BrakePedal   → brake_pedal (BOOLEAN column)
//   - enum    → Gear         → gear (TEXT column, value "ShiftStateD")
//
// drive_telemetry has 11 routed columns spanning three scalar kinds
// (9 DOUBLE PRECISION, 2 BOOLEAN, 1 TEXT-via-enum) so the matrix
// touches every column-type bucket the writer has to bind through
// either bindSnapshotValue at snapshot_base.go:194-209 or
// coerceProtoEnumToText.
//
// Each case asserts that the SQL contains the drive_telemetry table
// identifier and the expected column identifier (both
// pgx.Identifier-quoted), that the bound $3 argument is the bare
// value (proto-enum String() result for Gear, no coercion otherwise),
// and that exactly one Exec call was made.
func TestDriveTelemetryWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000020"
	ts := time.Date(2026, 5, 6, 14, 22, 0, 0, time.UTC)

	cases := []struct {
		name    string
		field   string
		col     string
		val     any
		boundAs any // value the writer is expected to bind on $3
	}{
		{name: "float64_VehicleSpeed", field: "VehicleSpeed", col: "speed_mps", val: float64(28.5), boundAs: float64(28.5)},
		{name: "bool_BrakePedal", field: "BrakePedal", col: "brake_pedal", val: true, boundAs: true},
		{name: "enum_Gear", field: "Gear", col: "gear", val: ftproto.ShiftState_ShiftStateD, boundAs: "ShiftStateD"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newDriveTelemetryTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestDriveTelemetry,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "drive_telemetry", tc.col)
			wantArgs := []any{vin, ts, tc.boundAs}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

func TestDriveTelemetryWriter_WriteBatchCoalescesEnumAndNumericFields(t *testing.T) {
	const vin = "5YJ3E1EA0KF000020"
	ts := time.Date(2026, 5, 6, 14, 22, 0, 0, time.UTC)
	rec := &recorder{rows: 1}
	writer := newDriveTelemetryTestWriter(t, rec)

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{
		{
			Atomic: codec.Atomic{
				Field: "Gear", Value: ftproto.ShiftState_ShiftStateD, EmittedAt: ts, VehicleID: vin,
			},
			Entry: router.Entry{Field: "Gear", Destination: router.DestDriveTelemetry, Column: "gear"},
		},
		{
			Atomic: codec.Atomic{
				Field: "VehicleSpeed", Value: float64(28.5), EmittedAt: ts, VehicleID: vin,
			},
			Entry: router.Entry{Field: "VehicleSpeed", Destination: router.DestDriveTelemetry, Column: "speed_mps"},
		},
	})

	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("WriteBatch results = %#v, want two nil entries", results)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1", len(rec.calls))
	}
	call := rec.calls[0]
	if !strings.Contains(call.SQL, `"gear"`) || !strings.Contains(call.SQL, `"speed_mps"`) {
		t.Fatalf("batch SQL missing drive columns: %s", call.SQL)
	}
	if got, want := call.Args, []any{vin, ts, "ShiftStateD", float64(28.5)}; !reflect.DeepEqual(got, want) {
		t.Fatalf("batch args = %#v, want %#v", got, want)
	}
}

// TestDriveTelemetryWriter_DriveIDNotTouched locks the invariant that the
// writer never references the drive_id column
// on insert. drive_id is backfilled by the session tracker observer
// in 0030 via a separate UPDATE; if the writer accidentally included
// drive_id in the column list it would either (a) write SQL NULL on
// insert, OR (b) overwrite a previously-set drive_id on re-delivery
// via the ON CONFLICT DO UPDATE SET clause — both are silent
// corruptions of the FK relationship into drives.
//
// We assert against the rendered SQL string for every routed field
// (not just one representative) because a future bug could affect
// only one column path (e.g. a regex-substitution accidentally
// inserts drive_id alongside a specific column type).
func TestDriveTelemetryWriter_DriveIDNotTouched(t *testing.T) {
	const vin = "5YJ3E1EA0KF000020"
	ts := time.Date(2026, 5, 6, 14, 22, 0, 0, time.UTC)

	for field, col := range driveTelemetryColumnByField {
		t.Run(field, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newDriveTelemetryTestWriter(t, rec)

			// Pick a value whose Go kind is unambiguously bindable
			// for the column type. float64 covers all 9 DOUBLE
			// PRECISION columns; bool covers the 2 BOOLEAN columns;
			// the typed proto enum covers the 1 TEXT column (gear).
			var val any
			switch col {
			case "brake_pedal", "drive_rail":
				val = true
			case "gear":
				val = ftproto.ShiftState_ShiftStateP
			default:
				val = float64(1)
			}

			err := w.Write(context.Background(), codec.Atomic{
				Field:     field,
				Value:     val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       field,
				Destination: router.DestDriveTelemetry,
				Column:      col,
			})
			if err != nil {
				t.Fatalf("Write(%s): %v", field, err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			sql := rec.calls[0].SQL
			if strings.Contains(sql, "drive_id") {
				t.Errorf("SQL for field %q contains drive_id (writer must leave the FK untouched per phase-42a prompt 0020 Decision #3): %q",
					field, sql)
			}
		})
	}
}

// TestDriveTelemetryWriter_UnknownFieldReturnsError verifies that a Field
// not routed to
// drive_telemetry must produce a "no column mapping" error and
// MUST NOT touch the DB.
//
// InsideTemp is a deliberate choice — it IS a routed field (dest:
// climate_snapshot per routing.yaml) so the test also implicitly
// guards against accidentally widening the drive_telemetry map to
// swallow non-driving fields.
func TestDriveTelemetryWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newDriveTelemetryTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "InsideTemp",
		Value:     float64(22.5),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "InsideTemp",
		Destination: router.DestDriveTelemetry,
	})
	if err == nil {
		t.Fatal("expected error for unrouted field, got nil")
	}
	if !strings.Contains(err.Error(), "no column mapping for field") {
		t.Errorf("error does not mention missing mapping: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "InsideTemp") {
		t.Errorf("error does not name the offending field: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "drive_telemetry") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestDriveTelemetryWriter_GearAcceptsStringPassthrough exercises
// the defensive idempotency arm of coerceProtoEnumToText: if a
// future codec change pre-stringifies the Gear enum at the codec
// boundary (so atom.Value arrives as plain string rather than
// ftproto.ShiftState), the writer must still bind cleanly.
//
// This is purely forward-compatibility insurance — today the codec
// emits the typed enum directly per protomodel/datum_decoder_gen.go:107-108
// and the TypeMatrix test pins that behaviour. The test passes
// "ShiftStateD" verbatim and asserts it lands on $3 unchanged.
func TestDriveTelemetryWriter_GearAcceptsStringPassthrough(t *testing.T) {
	const vin = "5YJ3E1EA0KF000020"
	ts := time.Date(2026, 5, 6, 14, 22, 0, 0, time.UTC)

	rec := &recorder{rows: 1}
	w := newDriveTelemetryTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "Gear",
		Value:     "ShiftStateP",
		EmittedAt: ts,
		VehicleID: vin,
	}, router.Entry{
		Field:       "Gear",
		Destination: router.DestDriveTelemetry,
		Column:      "gear",
	})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("calls=%d, want 1", got)
	}
	wantArgs := []any{vin, ts, "ShiftStateP"}
	if !reflect.DeepEqual(rec.calls[0].Args, wantArgs) {
		t.Errorf("args=%v, want %v", rec.calls[0].Args, wantArgs)
	}
}

// TestDriveTelemetryWriter_GearRejectsBadValues pins the loud-reject
// contract for coerceProtoEnumToText. Sub-cases mirror the
// switch-arm structure of the helper:
//
//   - nil               → "nil value not allowed"
//   - bool              → "unsupported value type" (default arm)
//   - int               → "unsupported value type" (default arm,
//     int has no String() method so does NOT satisfy fmt.Stringer
//     even though it is numeric)
//   - empty string      → "empty string not allowed"
//   - empty Stringer    → "Stringer ... returned empty string"
//
// raw int32 is deliberately exercised by typing it as plain int32
// (not a defined type) so it does NOT satisfy fmt.Stringer. A typed
// proto enum would satisfy Stringer and take the happy path.
func TestDriveTelemetryWriter_GearRejectsBadValues(t *testing.T) {
	cases := []struct {
		name     string
		val      any
		errChunk string
	}{
		{name: "nil", val: nil, errChunk: "nil value not allowed"},
		{name: "bool", val: true, errChunk: "unsupported value type"},
		{name: "int", val: int(5), errChunk: "unsupported value type"},
		{name: "raw_int32", val: int32(5), errChunk: "unsupported value type"},
		{name: "empty_string", val: "", errChunk: "empty string not allowed"},
		{name: "empty_stringer", val: emptyStringer{}, errChunk: "returned empty string"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newDriveTelemetryTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     "Gear",
				Value:     tc.val,
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}, router.Entry{
				Field:       "Gear",
				Destination: router.DestDriveTelemetry,
				Column:      "gear",
			})
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.errChunk) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.errChunk)
			}
			if !strings.Contains(err.Error(), "drive_telemetry") {
				t.Errorf("error %q does not name destination", err.Error())
			}
			if !strings.Contains(err.Error(), "Gear") {
				t.Errorf("error %q does not name field", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls on coerce failure, got %d", got)
			}
		})
	}
}

// emptyStringer is a fmt.Stringer whose String() returns the empty
// string. Used by TestDriveTelemetryWriter_GearRejectsBadValues to
// pin the "Stringer returned empty string" rejection path.
type emptyStringer struct{}

func (emptyStringer) String() string { return "" }

// TestNewDriveTelemetryWriter_NilPoolPanics locks the constructor's
// fail-fast contract. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewDriveTelemetryWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewDriveTelemetryWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewDriveTelemetryWriter(nil)
}

// TestDriveTelemetryWriter_SatisfiesRouterWriter mirrors the
// file-level compile-time `var _ router.Writer` assertion at runtime.
// A signature drift in router.Writer would fail the build at the
// compile-time assertion, but having this test makes the contract
// visible alongside the other writer tests and matches the precedent
// in security_event_writer_test.go / signal_log_writer_test.go.
func TestDriveTelemetryWriter_SatisfiesRouterWriter(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newDriveTelemetryTestWriter(t, rec)
	var _ router.Writer = w
}
