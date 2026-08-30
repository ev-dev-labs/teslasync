package writers

import (
	"context"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newTirePressureTestWriter wires a tirePressureWriter against the
// recording fake from snapshot_base_test.go (same package) using the
// production tirePressureColumnFor. We deliberately build the
// tirePressureWriter directly rather than going through
// NewTirePressureWriter because the public constructor takes a
// *pgxpool.Pool and the recorder is the smaller pgxPool interface —
// same seam pattern as climate_writer_test.go and motor_writer_test.go.
//
// The composed snapshotWriter under test is wired against the same
// recorder so both branches (timestamp and pressure) log into the
// shared call list and assertions can introspect either branch
// uniformly.
func newTirePressureTestWriter(t *testing.T, rec *recorder) *tirePressureWriter {
	t.Helper()
	snap, err := newSnapshotWriter(rec, "tire_pressure_snapshots", tirePressureColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for tire_pressure: %v", err)
	}
	return &tirePressureWriter{
		snap:      snap,
		db:        rec,
		table:     "tire_pressure_snapshots",
		columnFor: tirePressureColumnFor,
	}
}

// TestTirePressureWriter_ColumnMapMatchesRoutingYAML walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestTirePressure, and asserts the
// tirePressureColumnByField map in tire_pressure_writer.go matches
// the routing layer entry-for-entry — same field set, same column
// for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a tire_pressure_snapshot route but
//     tire_pressure_writer.go does not — Write would return "no
//     column mapping for field" at runtime, the test fails with
//     "missing field".
//
//   - tire_pressure_writer.go adds an entry that routing.yaml does
//     not — the entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     tire_pressure_writer.go — Write would target the wrong column
//     at runtime (or fail safeIdentRE), the test fails with
//     mismatched column.
func TestTirePressureWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestTirePressure {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 8; got != want {
		t.Errorf("routing.yaml has %d tire_pressure_snapshot entries, expected %d "+
			"(prompt 0014 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(tirePressureColumnByField), len(expected); got != want {
		t.Errorf("tirePressureColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := tirePressureColumnByField[field]
		if !ok {
			t.Errorf("tirePressureColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("tirePressureColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range tirePressureColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("tirePressureColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: tire_pressure_snapshot)",
				field, gotCol)
		}
	}
}

// TestTirePressureWriter_TimestampColumnsCoverTimestamptzColumns is a
// secondary drift gate. It asserts that every column in
// tirePressureTimestampColumns is also present as a target column in
// tirePressureColumnByField. A future writer regression that routes a
// non-timestamp field to e.g. front_left_last_seen_at would surface
// here AND at the type-matrix test below.
func TestTirePressureWriter_TimestampColumnsCoverTimestamptzColumns(t *testing.T) {
	cols := map[string]struct{}{}
	for _, c := range tirePressureColumnByField {
		cols[c] = struct{}{}
	}
	for tsCol := range tirePressureTimestampColumns {
		if _, ok := cols[tsCol]; !ok {
			t.Errorf("tirePressureTimestampColumns has %q but no routed field maps to that column",
				tsCol)
		}
	}
	if got, want := len(tirePressureTimestampColumns), 4; got != want {
		t.Errorf("tirePressureTimestampColumns has %d entries, expected %d (4 corners)",
			got, want)
	}
}

// TestTirePressureWriter_TypeMatrix exercises the two routed kinds.
// No `*_status` field is routed under dest: tire_pressure_snapshot in
// routing.yaml; status columns exist in the schema but are populated
// downstream from the signal_log change feed per routing.yaml lines
// 889-895.
//
//   - float64 → TpmsPressureFl → front_left_pa (DOUBLE PRECISION)
//     — pure delegation to snapshotWriter, $3 bound as the bare
//     float64 in Pa (already SI from normalize.toSI).
//
//   - float64 epoch → TpmsLastSeenPressureTimeFl →
//     front_left_last_seen_at (TIMESTAMPTZ) — handled by
//     writeTimestamp, $3 bound as the corresponding time.Time in UTC.
//
// Each case asserts the SQL contains the tire_pressure_snapshots
// table identifier and the expected column identifier (both
// pgx.Identifier-quoted), the bound $3 argument matches the expected
// type and value, and exactly one Exec call was made.
func TestTirePressureWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000142"
	emittedAt := time.Date(2026, 5, 6, 18, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		field   string
		col     string
		val     any
		wantArg any
	}{
		{
			name:    "float64_TpmsPressureFl",
			field:   "TpmsPressureFl",
			col:     "front_left_pa",
			val:     float64(222000.0), // ~32 psi expressed in Pa
			wantArg: float64(222000.0),
		},
		{
			name:    "epoch_TpmsLastSeenPressureTimeFl",
			field:   "TpmsLastSeenPressureTimeFl",
			col:     "front_left_last_seen_at",
			val:     float64(1746541200), // 2025-05-06T13:00:00Z
			wantArg: time.Unix(1746541200, 0).UTC(),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newTirePressureTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: emittedAt,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestTirePressure,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "tire_pressure_snapshots", tc.col)
			wantArgs := []any{vin, emittedAt, tc.wantArg}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

func TestTirePressureWriter_WriteBatchCoalescesTimestampAndPressure(t *testing.T) {
	const vin = "5YJ3E1EA0KF000142"
	emittedAt := time.Date(2026, 5, 6, 18, 0, 0, 0, time.UTC)
	lastSeenAt := time.Unix(1746541200, 250_000_000).UTC()
	rec := &recorder{rows: 1}
	writer := newTirePressureTestWriter(t, rec)

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{
		{
			Atomic: codec.Atomic{
				Field: "TpmsLastSeenPressureTimeFl", Value: float64(1746541200.25), EmittedAt: emittedAt, VehicleID: vin,
			},
			Entry: router.Entry{Field: "TpmsLastSeenPressureTimeFl", Destination: router.DestTirePressure},
		},
		{
			Atomic: codec.Atomic{
				Field: "TpmsPressureFl", Value: float64(222000), EmittedAt: emittedAt, VehicleID: vin,
			},
			Entry: router.Entry{Field: "TpmsPressureFl", Destination: router.DestTirePressure},
		},
	})

	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("WriteBatch results = %#v, want two nil entries", results)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1", len(rec.calls))
	}
	call := rec.calls[0]
	if !strings.Contains(call.SQL, `"front_left_last_seen_at"`) ||
		!strings.Contains(call.SQL, `"front_left_pa"`) {
		t.Fatalf("batch SQL missing tire-pressure columns: %s", call.SQL)
	}
	if got, want := call.Args, []any{vin, emittedAt, lastSeenAt, float64(222000)}; !reflect.DeepEqual(got, want) {
		t.Fatalf("batch args = %#v, want %#v", got, want)
	}
}

// TestTirePressureWriter_FractionalEpochPreserved guards the
// math.Modf + math.Round implementation in coerceEpochToTime
// against truncation/rounding regressions. Tesla emits epoch as
// float64 (ValueKindFloat per protomodel.SignalsByName) so a
// fractional value MUST land as a time.Time with the matching
// nanosecond precision rather than being silently truncated to
// the whole second.
//
// 1746541200.25 is chosen because 0.25 has an exact binary
// float64 representation, so the test does not depend on float
// arithmetic tolerance.
func TestTirePressureWriter_FractionalEpochPreserved(t *testing.T) {
	const vin = "5YJ3E1EA0KF000142"
	emittedAt := time.Date(2026, 5, 6, 18, 0, 0, 0, time.UTC)
	rec := &recorder{rows: 1}
	w := newTirePressureTestWriter(t, rec)

	err := w.Write(context.Background(), codec.Atomic{
		Field:     "TpmsLastSeenPressureTimeRr",
		Value:     float64(1746541200.25),
		EmittedAt: emittedAt,
		VehicleID: vin,
	}, router.Entry{
		Field:       "TpmsLastSeenPressureTimeRr",
		Destination: router.DestTirePressure,
		Column:      "rear_right_last_seen_at",
	})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("calls=%d, want 1", got)
	}
	wantTS := time.Unix(1746541200, 250_000_000).UTC()
	gotTS, ok := rec.calls[0].Args[2].(time.Time)
	if !ok {
		t.Fatalf("arg[2]=%T %v, want time.Time", rec.calls[0].Args[2], rec.calls[0].Args[2])
	}
	if !gotTS.Equal(wantTS) {
		t.Errorf("bound timestamp = %s, want %s (fractional epoch lost precision)",
			gotTS.Format(time.RFC3339Nano), wantTS.Format(time.RFC3339Nano))
	}
}

// TestTirePressureWriter_UnknownFieldReturnsError verifies that a
// Field not routed to tire_pressure_snapshot produces a "no column
// mapping" error and does NOT touch the DB. The error wording mirrors
// snapshot_base.go's prefix so the router classifyError tag set treats
// both branches identically.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also
// implicitly guards against accidentally widening the tire_pressure
// map to swallow non-tire fields.
func TestTirePressureWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTirePressureTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestTirePressure,
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
	if !strings.Contains(err.Error(), "tire_pressure_snapshots") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestTirePressureWriter_TimestampUnsupportedValueType pins the
// loud-reject contract for the timestamp branch. snapshotWriter
// rejects anything outside float64/int64/bool/string with
// "unsupported value type"; coerceEpochToTime mirrors that wording
// so a producer/codec drift (TpmsLastSeenPressureTimeFl emitting a
// string instead of a float64) surfaces as the same recognisable
// error.
//
// Probes both string (the most plausible accidental drift, e.g.
// the codec was changed to stringify timestamps) and int64 (the
// second most plausible — a producer that uses int64 epoch instead
// of float64). bool is included for parity with
// snapshot_base_test.go's matrix.
func TestTirePressureWriter_TimestampUnsupportedValueType(t *testing.T) {
	cases := []struct {
		name string
		val  any
	}{
		{name: "string", val: "1746541200"},
		{name: "int64", val: int64(1746541200)},
		{name: "bool", val: true},
		{name: "nil", val: nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newTirePressureTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     "TpmsLastSeenPressureTimeFl",
				Value:     tc.val,
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}, router.Entry{
				Field:       "TpmsLastSeenPressureTimeFl",
				Destination: router.DestTirePressure,
				Column:      "front_left_last_seen_at",
			})
			if err == nil {
				t.Fatalf("expected error for value type %T, got nil", tc.val)
			}
			if !strings.Contains(err.Error(), "unsupported value type") {
				t.Errorf("error does not mention unsupported type: %q", err.Error())
			}
			if !strings.Contains(err.Error(), "snapshotWriter[tire_pressure_snapshots].TpmsLastSeenPressureTimeFl:") {
				t.Errorf("error missing standard prefix: %q", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls for unsupported type, got %d", got)
			}
		})
	}
}

// TestTirePressureWriter_InvalidEpochValuesRejected covers the
// non-finite and out-of-range branches of coerceEpochToTime. NaN /
// Inf / negative epochs are producer-contract violations (a TPMS
// "last seen" before the unix epoch or undefined-floating-point is
// never meaningful) and the writer fails LOUDLY rather than
// silently writing garbage into a TIMESTAMPTZ column.
//
// Zero epoch is intentionally NOT rejected — see writeTimestamp
// godoc and the rubber-duck design review note: routing.yaml does
// not constrain zero as a sentinel and rejecting it would silently
// drop a "never-seen" marker that downstream consumers may want.
func TestTirePressureWriter_InvalidEpochValuesRejected(t *testing.T) {
	cases := []struct {
		name    string
		val     float64
		wantSub string
	}{
		{name: "NaN", val: math.NaN(), wantSub: "NaN"},
		{name: "PosInf", val: math.Inf(1), wantSub: "Inf"},
		{name: "NegInf", val: math.Inf(-1), wantSub: "Inf"},
		{name: "negative", val: -1.0, wantSub: "non-negative"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newTirePressureTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     "TpmsLastSeenPressureTimeFr",
				Value:     tc.val,
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}, router.Entry{
				Field:       "TpmsLastSeenPressureTimeFr",
				Destination: router.DestTirePressure,
				Column:      "front_right_last_seen_at",
			})
			if err == nil {
				t.Fatalf("expected error for value %v, got nil", tc.val)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error %q does not contain expected substring %q", err.Error(), tc.wantSub)
			}
			if !strings.Contains(err.Error(), "snapshotWriter[tire_pressure_snapshots].TpmsLastSeenPressureTimeFr:") {
				t.Errorf("error missing standard prefix: %q", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls for invalid epoch, got %d", got)
			}
		})
	}
}

// TestTirePressureWriter_ZeroEpochAccepted documents the deliberate
// choice NOT to reject zero epoch. routing.yaml lines 917-922 say
// the wire value is a "unix epoch in seconds" with no sentinel
// constraint; a TPMS sensor that has never reported (zero =
// 1970-01-01) is information the downstream consumer may want to
// observe explicitly rather than have silently dropped at the
// writer boundary. See rubber-duck design review (Q5).
func TestTirePressureWriter_ZeroEpochAccepted(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTirePressureTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "TpmsLastSeenPressureTimeRl",
		Value:     float64(0),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "TpmsLastSeenPressureTimeRl",
		Destination: router.DestTirePressure,
		Column:      "rear_left_last_seen_at",
	})
	if err != nil {
		t.Fatalf("Write: zero epoch rejected unexpectedly: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("calls=%d, want 1", got)
	}
	gotTS, ok := rec.calls[0].Args[2].(time.Time)
	if !ok {
		t.Fatalf("arg[2]=%T %v, want time.Time", rec.calls[0].Args[2], rec.calls[0].Args[2])
	}
	if !gotTS.Equal(time.Unix(0, 0).UTC()) {
		t.Errorf("bound timestamp = %s, want 1970-01-01T00:00:00Z", gotTS.Format(time.RFC3339Nano))
	}
}

// TestTirePressureWriter_TimestampVehicleNotRegistered exercises the
// timestamp branch's RowsAffected==0 path. snapshotWriter handles
// the same case for the pressure branch via shared snapshot_base
// tests, but the timestamp branch has its OWN INSERT so we
// explicitly guard:
//
//   - the error wording matches snapshot_base ("vehicle not registered"),
//   - the destination table appears in the error for log correlation,
//   - the field appears in the error for log correlation,
//   - the VIN does NOT appear in the error message (PII rule).
func TestTirePressureWriter_TimestampVehicleNotRegistered(t *testing.T) {
	const vin = "VIN-NOT-REGISTERED-TIRE"
	rec := &recorder{rows: 0}
	w := newTirePressureTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "TpmsLastSeenPressureTimeRr",
		Value:     float64(1746541200),
		EmittedAt: time.Now().UTC(),
		VehicleID: vin,
	}, router.Entry{
		Field:       "TpmsLastSeenPressureTimeRr",
		Destination: router.DestTirePressure,
		Column:      "rear_right_last_seen_at",
	})
	if err == nil {
		t.Fatal("expected error when RowsAffected==0, got nil")
	}
	if !strings.Contains(err.Error(), "vehicle not registered") {
		t.Errorf("error does not mention unknown vehicle: %q", err.Error())
	}
	if strings.Contains(err.Error(), vin) {
		t.Errorf("error message must NOT include VIN (PII): %q", err.Error())
	}
	if !strings.Contains(err.Error(), "tire_pressure_snapshots") {
		t.Errorf("error must include destination table for log correlation: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "TpmsLastSeenPressureTimeRr") {
		t.Errorf("error must include field name for log correlation: %q", err.Error())
	}
	// The exec DID run — we just observed RowsAffected==0.
	if got := len(rec.calls); got != 1 {
		t.Errorf("expected exactly one db call, got %d", got)
	}
}

// TestTirePressureWriter_TimestampDBExecErrorWrapped pins the
// error-wrapping format the router's classifyError tag set depends
// on for the timestamp branch. The wrapped error must be unwrappable
// via errors.Is so context.DeadlineExceeded / context.Canceled are
// still detectable downstream — same contract as
// TestWrite_DBExecErrorWrapped in snapshot_base_test.go.
func TestTirePressureWriter_TimestampDBExecErrorWrapped(t *testing.T) {
	sentinel := errors.New("simulated db failure")
	rec := &recorder{err: sentinel}
	w := newTirePressureTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "TpmsLastSeenPressureTimeFl",
		Value:     float64(1746541200),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "TpmsLastSeenPressureTimeFl",
		Destination: router.DestTirePressure,
		Column:      "front_left_last_seen_at",
	})
	if err == nil {
		t.Fatal("expected error from db.Exec, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("wrapped error does not unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "snapshotWriter[tire_pressure_snapshots].TpmsLastSeenPressureTimeFl:") {
		t.Errorf("error missing standard prefix: %q", err.Error())
	}
}

// TestNewTirePressureWriter_NilPoolPanics locks the constructor's
// fail-fast contract. A nil pool is a wiring bug and panics so the
// failure surfaces at process start, not at the first payload. Same
// panic pattern as NewClimateWriter / NewMotorWriter /
// NewPositionsWriter.
func TestNewTirePressureWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewTirePressureWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewTirePressureWriter(nil)
}
