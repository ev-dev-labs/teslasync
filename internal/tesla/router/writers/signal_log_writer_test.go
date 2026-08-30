package writers

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newSignalLogTestWriter wires a signalLogWriter against the shared
// recorder fake from snapshot_base_test.go (same package). We
// deliberately build the writer directly rather than through
// NewSignalLogWriter because the public constructor takes a
// *pgxpool.Pool and the recorder is the smaller signalLogPool
// interface — same seam pattern as climate_writer_test.go's
// newClimateTestWriter / safety_writer_test.go's newSafetyTestWriter /
// security_event_writer_test.go's newSecurityEventTestWriter.
func newSignalLogTestWriter(t *testing.T, rec *recorder) *signalLogWriter {
	t.Helper()
	return &signalLogWriter{db: rec}
}

// assertSignalLogCallShape factors the SQL-shape assertions every
// happy-path test repeats. The rendered SQL must contain the VIN-lookup
// subquery, the ON CONFLICT clause keyed on (vehicle_id, ts, field),
// and the all-typed-column update list defended by the cold-path
// invariant (000186_signal_log.up.sql:76-77).
func assertSignalLogCallShape(t *testing.T, call recordedCall) {
	t.Helper()
	if !strings.Contains(call.SQL, "FROM vehicles v") || !strings.Contains(call.SQL, "WHERE v.vin = $1") {
		t.Errorf("SQL missing VIN lookup: %q", call.SQL)
	}
	if !strings.Contains(call.SQL, "ON CONFLICT (vehicle_id, ts, field) DO UPDATE SET") {
		t.Errorf("SQL missing ON CONFLICT clause keyed on (vehicle_id, ts, field): %q", call.SQL)
	}
	// All five typed columns plus value_kind must appear in the
	// EXCLUDED.<col> update list. We use the EXCLUDED.<col> token
	// rather than the full LHS=EXCLUDED.RHS clause so the assertion
	// stays robust against future alignment-spacing changes in
	// signalLogInsertSQL.
	for _, col := range []string{
		"value_kind",
		"str_value",
		"bool_value",
		"int_value",
		"float_value",
		"time_value",
		"normalization_version",
		"ingest_origin",
		"source_emitted_at",
		"received_at",
	} {
		if !strings.Contains(call.SQL, "EXCLUDED."+col) {
			t.Errorf("SQL missing EXCLUDED.%s in update list: %q", col, call.SQL)
		}
	}
	if !strings.Contains(signalLogInsertSQL, "normalization_write_token") ||
		!strings.Contains(signalLogInsertSQL, "provenance_write_token") ||
		!strings.Contains(signalLogInsertSQL, "NOT COALESCE") {
		t.Error("conflict update must toggle independent normalization and provenance tokens")
	}
}

// TestSignalLogWriter_RoutingYAMLCoverage is the reflective coverage
// gate for signal_log routing. It walks router.LoadMap() (which parses
// the embedded routing.yaml), counts entries with Destination==DestSignalLog,
// and asserts the count matches the current audited baseline.
//
// The exact-count form (rather than >=144) is deliberate: any future
// addition of a `dest: signal_log` route SHOULD bump the constant
// here in the same commit so the change shows up in code review and
// the writer authors are forced to acknowledge that a new field type
// (e.g. a future []byte payload) might require widening
// signalLogClassify. If the producer-introduced field type is already
// in the LOCKED set (string/bool/int32/int64/float32/float64/time.Time/
// proto enum), the bump-only edit is trivial.
func TestSignalLogWriter_RoutingYAMLCoverage(t *testing.T) {
	const wantSignalLogRoutes = 144

	entries, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}
	got := 0
	for _, e := range entries {
		if e.Destination == router.DestSignalLog {
			got++
		}
	}
	if got != wantSignalLogRoutes {
		t.Fatalf("dest: signal_log routes = %d, want %d (update the constant here in the same commit if routing.yaml changed intentionally)", got, wantSignalLogRoutes)
	}
}

// TestSignalLogWriter_TypeMatrix covers every kind the writer supports
// (per migration 000186_signal_log.up.sql:79-88). Each sub-case asserts:
//
//  1. Write returns nil on the happy path (RowsAffected==1).
//  2. Exactly one Exec call was issued (no slow-path disambiguation
//     because the cold-path writer doesn't have one).
//  3. The bound value_kind matches the migration's discriminator.
//  4. The corresponding typed column is bound with the value, and
//     the four other typed columns are bound as untyped nil so pgx
//     binds them as SQL NULL — defending the migration's invariant
//     that exactly one typed column is non-null per row.
//
// The proto-enum sub-case uses ftproto.ShiftState_ShiftStateD (the
// codec emits typed proto enums per
// protomodel/datum_decoder_gen.go:107-108) to pin the enum-detection
// path that the godoc on signalLogClassify documents.
func TestSignalLogWriter_TypeMatrix(t *testing.T) {
	const (
		vin   = "5YJ3E1EA0KF000001"
		field = "TestField"
	)
	emittedAt := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name     string
		val      any
		wantKind int16
		wantCol  string // index 5..9 of bound args; col → arg index via colArgIndex
		wantArg  any
	}{
		{name: "string", val: "hello", wantKind: signalLogKindString, wantCol: "str_value", wantArg: "hello"},
		{name: "bool_true", val: true, wantKind: signalLogKindBool, wantCol: "bool_value", wantArg: true},
		{name: "bool_false", val: false, wantKind: signalLogKindBool, wantCol: "bool_value", wantArg: false},
		{name: "int32", val: int32(-7), wantKind: signalLogKindInt32, wantCol: "int_value", wantArg: int64(-7)},
		{name: "int64", val: int64(1<<40 + 3), wantKind: signalLogKindInt64, wantCol: "int_value", wantArg: int64(1<<40 + 3)},
		{name: "float32", val: float32(1.5), wantKind: signalLogKindFloat, wantCol: "float_value", wantArg: float64(1.5)},
		{name: "float64", val: float64(2.71828), wantKind: signalLogKindDouble, wantCol: "float_value", wantArg: float64(2.71828)},
		{name: "time", val: time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC), wantKind: signalLogKindTime, wantCol: "time_value", wantArg: time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC)},
		{name: "proto_enum_ShiftState", val: ftproto.ShiftState_ShiftStateD, wantKind: signalLogKindEnum, wantCol: "int_value", wantArg: int64(ftproto.ShiftState_ShiftStateD)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newSignalLogTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field: field, Value: tc.val, EmittedAt: emittedAt, VehicleID: vin,
			}, router.Entry{Field: field, Destination: router.DestSignalLog})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertSignalLogCallShape(t, call)

			if got := len(call.Args); got != 13 {
				t.Fatalf("Args=%d, want 13 ($1 vin .. $10 normalization_version, $11-$13 provenance)", got)
			}
			if got := call.Args[0]; got != vin {
				t.Errorf("$1 vin = %v, want %v", got, vin)
			}
			if got := call.Args[1]; !reflect.DeepEqual(got, emittedAt) {
				t.Errorf("$2 ts = %v, want %v", got, emittedAt)
			}
			if got := call.Args[2]; got != field {
				t.Errorf("$3 field = %v, want %v", got, field)
			}
			if got, ok := call.Args[3].(int16); !ok || got != tc.wantKind {
				t.Errorf("$4 value_kind = %v (%T), want %d (int16)", call.Args[3], call.Args[3], tc.wantKind)
			}

			// Verify the active typed column carries the bound value
			// and the four others are untyped nil.
			columns := []string{"str_value", "bool_value", "int_value", "float_value", "time_value"}
			for i, col := range columns {
				argIndex := 4 + i // $5..$9
				got := call.Args[argIndex]
				if col == tc.wantCol {
					if !reflect.DeepEqual(got, tc.wantArg) {
						t.Errorf("$%d %s = %v (%T), want %v (%T)", argIndex+1, col, got, got, tc.wantArg, tc.wantArg)
					}
				} else if got != nil {
					t.Errorf("$%d %s = %v (%T), want nil (cold-path invariant: exactly one typed column non-null)", argIndex+1, col, got, got)
				}
			}
			if got := call.Args[9]; got != signalLogNormalizationVersion {
				t.Errorf("$10 normalization_version = %v, want %d", got, signalLogNormalizationVersion)
			}
			if got := call.Args[10]; got != codec.IngestOriginUnknown {
				t.Errorf("$11 ingest_origin = %v, want explicit unknown", got)
			}
			if got := call.Args[11]; got != nil {
				t.Errorf("$12 source_emitted_at = %v, want nil without source evidence", got)
			}
			if got := call.Args[12]; got != nil {
				t.Errorf("$13 received_at = %v, want nil when unavailable", got)
			}
		})
	}
}

func TestSignalLogWriter_StampedProvenancePersistsAtomically(t *testing.T) {
	emittedAt := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	receivedAt := emittedAt.Add(2 * time.Second)
	rec := &recorder{rows: 1}
	w := newSignalLogTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:           "Soc",
		Value:           float32(42),
		EmittedAt:       emittedAt,
		VehicleID:       "VIN",
		IngestOrigin:    codec.IngestOriginFleetTelemetryMQTT,
		SourceEmittedAt: &emittedAt,
		ReceivedAt:      &receivedAt,
	}, router.Entry{Field: "Soc", Destination: router.DestSignalLog})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	call := rec.calls[0]
	if got := call.Args[10]; got != codec.IngestOriginFleetTelemetryMQTT {
		t.Errorf("$11 ingest_origin = %v, want fleet_telemetry_mqtt", got)
	}
	if got := call.Args[11]; !reflect.DeepEqual(got, emittedAt) {
		t.Errorf("$12 source_emitted_at = %v, want %v", got, emittedAt)
	}
	if got := call.Args[12]; !reflect.DeepEqual(got, receivedAt) {
		t.Errorf("$13 received_at = %v, want %v", got, receivedAt)
	}
}

func TestSignalLogWriter_WriteBatchUsesOneInsert(t *testing.T) {
	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	rec := &recorder{rows: 2}
	writer := newSignalLogTestWriter(t, rec)

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{
		{
			Atomic: codec.Atomic{
				Field: "Soc", Value: float32(75), EmittedAt: ts, VehicleID: "VIN",
			},
			Entry: router.Entry{Field: "Soc", Destination: router.DestSignalLog},
		},
		{
			Atomic: codec.Atomic{
				Field: "Locked", Value: true, EmittedAt: ts, VehicleID: "VIN",
			},
			Entry: router.Entry{Field: "Locked", Destination: router.DestSignalLog},
		},
	})

	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("WriteBatch results = %#v, want two nil entries", results)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1", len(rec.calls))
	}
	call := rec.calls[0]
	if !strings.Contains(call.SQL, "CROSS JOIN (VALUES") {
		t.Errorf("batch SQL missing VALUES input: %s", call.SQL)
	}
	if !strings.Contains(call.SQL, "ON CONFLICT (vehicle_id, ts, field) DO UPDATE SET") {
		t.Errorf("batch SQL missing idempotent conflict clause: %s", call.SQL)
	}
	if got := len(call.Args); got != 25 {
		t.Fatalf("batch args = %d, want 25 (one VIN plus 12 per row)", got)
	}
	if call.Args[0] != "VIN" || call.Args[2] != "Soc" || call.Args[14] != "Locked" {
		t.Errorf("batch args do not preserve VIN/field values: %#v", call.Args)
	}
}

func TestSignalLogWriter_WriteBatchCollapsesExactRedelivery(t *testing.T) {
	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	rec := &recorder{rows: 1}
	writer := newSignalLogTestWriter(t, rec)
	item := router.RoutedAtomic{
		Atomic: codec.Atomic{
			Field: "Soc", Value: float32(75), EmittedAt: ts, VehicleID: "VIN",
		},
		Entry: router.Entry{Field: "Soc", Destination: router.DestSignalLog},
	}

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{item, item})
	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("WriteBatch results = %#v, want duplicate delivery accepted", results)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1", len(rec.calls))
	}
	if got := len(rec.calls[0].Args); got != 13 {
		t.Fatalf("deduplicated batch args = %d, want 13", got)
	}
}

// TestSignalLogWriter_TimestampNormalisation pins the UTC + monotonic-
// strip canonicalisation. A Payload.CreatedAt arriving as a
// non-UTC time.Time MUST land in signal_log as UTC so two atomics
// from the same payload key-equal regardless of server-local
// timezone. Mirrors security_event_writer_test.go's
// TestSecurityEventWriter_TimestampNormalisation contract.
func TestSignalLogWriter_TimestampNormalisation(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	emittedLA := time.Date(2026, 5, 6, 5, 34, 56, 0, la)
	wantUTC := emittedLA.UTC().Round(0)

	rec := &recorder{rows: 1}
	w := newSignalLogTestWriter(t, rec)
	err = w.Write(context.Background(), codec.Atomic{
		Field: "VehicleSpeed", Value: float64(42), EmittedAt: emittedLA, VehicleID: "VIN-1",
	}, router.Entry{Field: "VehicleSpeed", Destination: router.DestSignalLog})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := len(rec.calls); got != 1 {
		t.Fatalf("calls=%d, want 1", got)
	}
	got := rec.calls[0].Args[1].(time.Time)
	if !got.Equal(wantUTC) {
		t.Errorf("$2 ts = %v, want equal to %v", got, wantUTC)
	}
	if got.Location() != time.UTC {
		t.Errorf("$2 ts location = %v, want UTC", got.Location())
	}
}

// TestSignalLogClassify_NilRejected pins the "no silent NULL writes"
// rule. Sending a nil value would yield a row with all five typed
// columns NULL — useless for the cold-path change feed and a contract
// drift the writer must surface loudly.
func TestSignalLogClassify_NilRejected(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newSignalLogTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: nil, EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{Field: "F", Destination: router.DestSignalLog})
	if err == nil {
		t.Fatal("expected error for nil value, got nil")
	}
	if !strings.Contains(err.Error(), "nil value not allowed") {
		t.Errorf("error does not mention nil rejection: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls for nil value, got %d", got)
	}
}

// TestSignalLogClassify_UnsupportedTypeRejected covers the "anything
// outside the 8 LOCKED kinds" rejection branch. We probe with types
// that have neither Int32 kind (which would dispatch to the enum
// branch) nor any of the explicit cases, so the default arm's
// fallback rejection fires. The Exec MUST NOT happen.
func TestSignalLogClassify_UnsupportedTypeRejected(t *testing.T) {
	cases := []struct {
		name string
		val  any
	}{
		{name: "byte_slice", val: []byte("hello")},
		{name: "string_slice", val: []string{"a", "b"}},
		{name: "map", val: map[string]int{"k": 1}},
		{name: "uint64", val: uint64(42)},
		{name: "int", val: int(7)}, // platform-dependent width — explicitly NOT in the LOCKED set
		{name: "complex", val: complex(1, 2)},
		{name: "struct", val: struct{ X int }{X: 3}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newSignalLogTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field: "F", Value: tc.val, EmittedAt: time.Now().UTC(), VehicleID: "VIN",
			}, router.Entry{Field: "F", Destination: router.DestSignalLog})
			if err == nil {
				t.Fatalf("expected error for value type %T, got nil", tc.val)
			}
			if !strings.Contains(err.Error(), "unsupported value type") {
				t.Errorf("error does not mention unsupported type: %q", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls for unsupported type, got %d", got)
			}
		})
	}
}

// TestSignalLogClassify_EnumDispatch pins the proto-enum detection
// path documented in signalLogClassify's godoc. The writer detects
// proto enums via reflect.ValueOf(v).Kind() == reflect.Int32 in the
// default arm, NOT via a protoreflect.Enum interface assertion (which
// would require importing google.golang.org/protobuf — currently an
// indirect go.mod dependency). This test pins the current behaviour
// so a future migration to protoreflect doesn't silently change the
// classification.
//
// All Tesla protomodel-emitted enums are int32-based per the proto3
// spec (e.g. ftproto.ShiftState, ftproto.ChargingState,
// ftproto.SentryModeState). We sample three to defend against a
// regression where one specific enum's String() / Number() pattern
// breaks the dispatch.
func TestSignalLogClassify_EnumDispatch(t *testing.T) {
	cases := []struct {
		name    string
		val     any
		wantNum int64
	}{
		{name: "ShiftState_D", val: ftproto.ShiftState_ShiftStateD, wantNum: int64(ftproto.ShiftState_ShiftStateD)},
		{name: "ChargingState_Charging", val: ftproto.ChargingState_ChargeStateCharging, wantNum: int64(ftproto.ChargingState_ChargeStateCharging)},
		{name: "SentryModeState_Armed", val: ftproto.SentryModeState_SentryModeStateArmed, wantNum: int64(ftproto.SentryModeState_SentryModeStateArmed)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bound, err := signalLogClassify(tc.val)
			if err != nil {
				t.Fatalf("signalLogClassify: %v", err)
			}
			if bound.kind != signalLogKindEnum {
				t.Errorf("kind = %d, want %d (Enum)", bound.kind, signalLogKindEnum)
			}
			if got, ok := bound.integer.(int64); !ok || got != tc.wantNum {
				t.Errorf("integer = %v (%T), want %d (int64)", bound.integer, bound.integer, tc.wantNum)
			}
			// All five typed columns must be exclusive.
			if bound.str != nil {
				t.Errorf("str = %v, want nil", bound.str)
			}
			if bound.boolean != nil {
				t.Errorf("boolean = %v, want nil", bound.boolean)
			}
			if bound.float != nil {
				t.Errorf("float = %v, want nil", bound.float)
			}
			if bound.timeVal != nil {
				t.Errorf("timeVal = %v, want nil", bound.timeVal)
			}
		})
	}
}

// TestSignalLogWriter_RowsAffectedZeroReturnsUnknownVehicleError is
// the VIN-not-in-vehicles branch. The cold-path writer has no slow-
// path disambiguation (RowsAffected==0 is unambiguously "vehicle not
// registered" because the typed-column ON CONFLICT DO UPDATE always
// either inserts or updates one row when the VIN exists). The error
// message MUST NOT contain the VIN itself (PII) but must clearly
// identify the field for log correlation.
func TestSignalLogWriter_RowsAffectedZeroReturnsUnknownVehicleError(t *testing.T) {
	const vin = "VIN-NOT-REGISTERED-XYZ"
	rec := &recorder{rows: 0}
	w := newSignalLogTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field: "BatteryLevel", Value: float64(75), EmittedAt: time.Now().UTC(), VehicleID: vin,
	}, router.Entry{Field: "BatteryLevel", Destination: router.DestSignalLog})
	if err == nil {
		t.Fatal("expected error when RowsAffected==0, got nil")
	}
	if !strings.Contains(err.Error(), "vehicle not registered") {
		t.Errorf("error does not mention unknown vehicle: %q", err.Error())
	}
	if strings.Contains(err.Error(), vin) {
		t.Errorf("error message must NOT include VIN (PII): %q", err.Error())
	}
	if !strings.Contains(err.Error(), "BatteryLevel") {
		t.Errorf("error must include field name for log correlation: %q", err.Error())
	}
	// The exec DID run — we just observed RowsAffected==0.
	if got := len(rec.calls); got != 1 {
		t.Errorf("expected exactly one db call, got %d", got)
	}
}

// TestSignalLogWriter_DBExecErrorWrapped pins the error-wrapping
// format the router's classifyError tag set depends on. The wrapped
// error must be unwrappable via errors.Is so context.DeadlineExceeded
// / context.Canceled are still detectable downstream.
func TestSignalLogWriter_DBExecErrorWrapped(t *testing.T) {
	sentinel := errors.New("simulated db failure")
	rec := &recorder{err: sentinel}
	w := newSignalLogTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: float64(1), EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{Field: "F", Destination: router.DestSignalLog})
	if err == nil {
		t.Fatal("expected error from db.Exec, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("wrapped error does not unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "signalLogWriter.F:") {
		t.Errorf("error missing standard prefix: %q", err.Error())
	}
}

// TestNewSignalLogWriter_NilPoolPanics locks the constructor's
// fail-fast contract. A nil pool is a wiring bug at process start so
// the panic stops the binary before any payload is processed.
// Mirrors the panic patterns in NewClimateWriter / NewMediaWriter /
// NewSafetyWriter / NewLocationWriter / NewTirePressureWriter /
// NewSecurityEventWriter / NewChargingTelemetryWriter /
// NewPositionsWriter / NewMotorWriter.
func TestNewSignalLogWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic from NewSignalLogWriter(nil), got none")
		}
		msg := fmt.Sprintf("%v", r)
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewSignalLogWriter(nil)
}

// TestSignalLogWriter_SatisfiesRouterWriter is a runtime confirmation
// of the compile-time assertion in signal_log_writer.go. Keeping it
// as a runtime test as well makes the contract greppable from the
// tests folder.
func TestSignalLogWriter_SatisfiesRouterWriter(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newSignalLogTestWriter(t, rec)
	var _ router.Writer = w
}
