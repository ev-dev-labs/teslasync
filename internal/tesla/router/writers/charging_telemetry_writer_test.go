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

// newChargingTelemetryTestWriter wires a snapshotWriter against the
// recording fake from snapshot_base_test.go (same package) using the
// production charging_telemetry columnFor. We deliberately build the
// snapshotWriter directly rather than going through
// NewChargingTelemetryWriter because the public constructor takes a
// *pgxpool.Pool and the recorder is the smaller pgxPool interface —
// same seam pattern as positions_writer_test.go and
// climate_writer_test.go.
func newChargingTelemetryTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "charging_telemetry", chargingTelemetryColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for charging_telemetry: %v", err)
	}
	return w
}

// TestChargingTelemetryWriter_ColumnMapMatchesRoutingYAML is the
// reflective coverage gate from phase-42a prompt 0019 Decision #5. It
// walks router.LoadMap() (which parses the embedded routing.yaml),
// filters to entries with Destination == DestChargingTelemetry, and
// asserts the chargingTelemetryColumnByField map in
// charging_telemetry_writer.go matches the routing layer
// entry-for-entry — same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a charging_telemetry route but
//     charging_telemetry_writer.go does not — Write would return
//     "no column mapping for field" at runtime, the test fails with
//     "missing field".
//
//   - charging_telemetry_writer.go adds an entry that routing.yaml
//     does not — the entry is dead code, the test fails with
//     "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     charging_telemetry_writer.go — Write would target the wrong
//     column at runtime (or fail safeIdentRE), the test fails with
//     mismatched column.
func TestChargingTelemetryWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestChargingTelemetry {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 12; got != want {
		t.Errorf("routing.yaml has %d charging_telemetry entries, expected %d "+
			"(prompt 0019 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(chargingTelemetryColumnByField), len(expected); got != want {
		t.Errorf("chargingTelemetryColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := chargingTelemetryColumnByField[field]
		if !ok {
			t.Errorf("chargingTelemetryColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("chargingTelemetryColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range chargingTelemetryColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("chargingTelemetryColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: charging_telemetry)",
				field, gotCol)
		}
	}
}

// TestChargingTelemetryWriter_TypeMatrix exercises one positive write
// per kind from phase-42a prompt 0019 Decision #6: float64, int64,
// bool, text. We pick representative routed fields so the map lookup
// AND the snapshotWriter SQL composition are both covered:
//
//   - float64 → ACChargingPower → ac_charging_power_w (DOUBLE PRECISION column)
//   - int64   → ChargerPhases   → charger_phases (INTEGER column)
//   - bool    → BatteryHeaterOn → battery_heater_on (BOOLEAN column)
//   - text    → FastChargerType → fast_charger_type (TEXT column)
//
// charging_telemetry has 12 routed columns spanning all four scalar
// kinds (7 DOUBLE PRECISION, 1 INTEGER, 2 BOOLEAN, 2 TEXT) so the
// matrix touches every column-type bucket the snapshotWriter helper
// has to bind through bindSnapshotValue at snapshot_base.go:194-209.
//
// Each case asserts that the SQL contains the charging_telemetry
// table identifier and the expected column identifier (both
// pgx.Identifier-quoted), that the bound $3 argument is the bare
// value (no coercion), and that exactly one Exec call was made.
func TestChargingTelemetryWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000019"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name    string
		field   string
		col     string
		val     any
		wantArg any
	}{
		{name: "float64_ACChargingPower", field: "ACChargingPower", col: "ac_charging_power_w", val: float64(11000.5), wantArg: float64(11000.5)},
		{name: "int64_ChargerPhases", field: "ChargerPhases", col: "charger_phases", val: int64(3), wantArg: float64(3)},
		{name: "bool_BatteryHeaterOn", field: "BatteryHeaterOn", col: "battery_heater_on", val: true, wantArg: true},
		{name: "text_FastChargerType", field: "FastChargerType", col: "fast_charger_type", val: "Combo", wantArg: "Combo"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newChargingTelemetryTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestChargingTelemetry,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "charging_telemetry", tc.col)
			wantArgs := []any{vin, ts, tc.wantArg}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestChargingTelemetryWriter_SessionIDNotTouched locks phase-42a
// prompt 0019 Decision #3: the writer NEVER references the session_id
// column on insert. session_id is backfilled by the session tracker
// observer in 0030 via a separate UPDATE; if the writer accidentally
// included session_id in the column list it would either (a) write
// SQL NULL on insert, OR (b) overwrite a previously-set session_id on
// re-delivery via the ON CONFLICT DO UPDATE SET clause — both are
// silent corruptions of the FK relationship into charging_sessions.
//
// We assert against the rendered SQL string for every routed field
// (not just one representative) because a future bug could affect
// only one column path (e.g. a regex-substitution accidentally
// inserts session_id alongside a specific column type).
func TestChargingTelemetryWriter_SessionIDNotTouched(t *testing.T) {
	const vin = "5YJ3E1EA0KF000019"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	for field, col := range chargingTelemetryColumnByField {
		t.Run(field, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newChargingTelemetryTestWriter(t, rec)

			// Pick a value whose Go kind is unambiguously bindable —
			// float64 covers all 7 DOUBLE PRECISION columns; for the
			// non-numeric columns we route through the matching scalar
			// kind so bindSnapshotValue does not error before the SQL
			// is even composed.
			var val any
			switch col {
			case "battery_heater_on", "charge_port_door_open":
				val = true
			case "charger_phases":
				val = int64(3)
			case "fast_charger_type", "charging_cable_type", "charge_port_latch":
				val = "X"
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
				Destination: router.DestChargingTelemetry,
				Column:      col,
			})
			if err != nil {
				t.Fatalf("Write(%s): %v", field, err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			sql := rec.calls[0].SQL
			if strings.Contains(sql, "session_id") {
				t.Errorf("SQL for field %q contains session_id (writer must leave the FK untouched per phase-42a prompt 0019 Decision #3): %q",
					field, sql)
			}
		})
	}
}

// TestChargingTelemetryWriter_UnknownFieldReturnsError covers
// phase-42a prompt 0019 Decision #6: a Field that is NOT routed to
// charging_telemetry must produce a "no column mapping" error and
// MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also
// implicitly guards against accidentally widening the
// charging_telemetry map to swallow non-charging fields.
func TestChargingTelemetryWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newChargingTelemetryTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestChargingTelemetry,
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
	if !strings.Contains(err.Error(), "charging_telemetry") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestNewChargingTelemetryWriter_NilPoolPanics locks the
// constructor's fail-fast contract from phase-42a prompt 0019
// Decision #1. A nil pool is a wiring bug and panics so the failure
// surfaces at process start, not at the first payload.
func TestNewChargingTelemetryWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewChargingTelemetryWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewChargingTelemetryWriter(nil)
}
