package writers

import (
	"context"
	"testing"
	"time"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// TestSignalLogCanonicalNumericKind_TransportIndependentLabel pins the
// cross-transport defect this function exists to remove: the proto batch
// path decodes the Value oneof the producer chose (float32 for
// Value_FloatValue, float64 for Value_DoubleValue) while the per-field JSON
// path decodes the width the catalog declares, so the SAME observation used
// to reach signal_log under two different value_kind labels.
//
// VehicleSpeed and BatteryLevel are catalog-declared ValueKindFloat, so both
// runtime widths must collapse onto the declared label.
func TestSignalLogCanonicalNumericKind_TransportIndependentLabel(t *testing.T) {
	t.Parallel()

	for _, field := range []string{"VehicleSpeed", "BatteryLevel", "Odometer"} {
		meta := protomodel.SignalsByName[field]
		if meta == nil || meta.ValueKind != protomodel.ValueKindFloat {
			t.Fatalf("catalog precondition changed: %s is not ValueKindFloat", field)
		}
		httpLabel := signalLogCanonicalNumericKind(field, signalLogKindDouble)
		mqttLabel := signalLogCanonicalNumericKind(field, signalLogKindFloat)
		if httpLabel != mqttLabel {
			t.Errorf("%s: http label=%d, mqtt label=%d, want identical", field, httpLabel, mqttLabel)
		}
		if httpLabel != signalLogKindFloat {
			t.Errorf("%s: canonical label=%d, want %d (catalog-declared Float)", field, httpLabel, signalLogKindFloat)
		}
	}
}

// TestSignalLogCanonicalNumericKind_Matrix covers every branch, including the
// deliberate non-canonicalisation cases that keep drift visible.
func TestSignalLogCanonicalNumericKind_Matrix(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		field string
		kind  int16
		want  int16
	}{
		{
			name:  "float64 on a declared-float signal is relabelled",
			field: "VehicleSpeed",
			kind:  signalLogKindDouble,
			want:  signalLogKindFloat,
		},
		{
			name:  "float32 on a declared-float signal keeps its label",
			field: "VehicleSpeed",
			kind:  signalLogKindFloat,
			want:  signalLogKindFloat,
		},
		{
			name:  "unknown field keeps the runtime label",
			field: "NotACatalogSignal",
			kind:  signalLogKindDouble,
			want:  signalLogKindDouble,
		},
		{
			name:  "flattened compound child without catalog entry keeps the runtime label",
			field: "LocationLatitude",
			kind:  signalLogKindDouble,
			want:  signalLogKindDouble,
		},
		{
			name:  "integer runtime value on a declared-float signal is left alone",
			field: "VehicleSpeed",
			kind:  signalLogKindInt64,
			want:  signalLogKindInt64,
		},
		{
			name:  "string label is never touched",
			field: "VehicleSpeed",
			kind:  signalLogKindString,
			want:  signalLogKindString,
		},
		{
			name:  "bool label is never touched",
			field: "BatteryHeaterOn",
			kind:  signalLogKindBool,
			want:  signalLogKindBool,
		},
		{
			name:  "time label is never touched",
			field: "VehicleSpeed",
			kind:  signalLogKindTime,
			want:  signalLogKindTime,
		},
		{
			name:  "enum label is never touched",
			field: "ChargeState",
			kind:  signalLogKindEnum,
			want:  signalLogKindEnum,
		},
		{
			name:  "float on an enum-declared signal keeps the runtime label so drift stays visible",
			field: "ChargeState",
			kind:  signalLogKindDouble,
			want:  signalLogKindDouble,
		},
		{
			name:  "float on a string-declared signal keeps the runtime label",
			field: "Vin",
			kind:  signalLogKindFloat,
			want:  signalLogKindFloat,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := signalLogCanonicalNumericKind(tc.field, tc.kind); got != tc.want {
				t.Errorf("signalLogCanonicalNumericKind(%q, %d) = %d, want %d", tc.field, tc.kind, got, tc.want)
			}
		})
	}
}

// TestSignalLogWriter_CanonicalisesNumericKindAtWrite asserts the writer binds
// the canonical label while leaving the numeric magnitude untouched — the
// canonicalisation is a label decision, never a value rewrite, so SI values
// keep full float64 precision in the DOUBLE PRECISION column.
func TestSignalLogWriter_CanonicalisesNumericKindAtWrite(t *testing.T) {
	const vin = "5YJ3E1EA0KF000001"
	emittedAt := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		field     string
		value     any
		wantKind  int16
		wantFloat float64
	}{
		{
			name:      "http float64 SI value",
			field:     "VehicleSpeed",
			value:     float64(20.117999999999999),
			wantKind:  signalLogKindFloat,
			wantFloat: 20.117999999999999,
		},
		{
			name:      "mqtt float32 value widened for storage",
			field:     "VehicleSpeed",
			value:     float32(20.118),
			wantKind:  signalLogKindFloat,
			wantFloat: float64(float32(20.118)),
		},
		{
			name:      "uncatalogued field keeps the runtime label",
			field:     "TestField",
			value:     float64(3.5),
			wantKind:  signalLogKindDouble,
			wantFloat: 3.5,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newSignalLogTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field: tc.field, Value: tc.value, EmittedAt: emittedAt, VehicleID: vin,
			}, router.Entry{Field: tc.field, Destination: router.DestSignalLog})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if len(rec.calls) != 1 {
				t.Fatalf("calls = %d, want 1", len(rec.calls))
			}
			call := rec.calls[0]
			if got, ok := call.Args[3].(int16); !ok || got != tc.wantKind {
				t.Errorf("$4 value_kind = %v (%T), want %d", call.Args[3], call.Args[3], tc.wantKind)
			}
			got, ok := call.Args[7].(float64)
			if !ok {
				t.Fatalf("$8 float_value = %v (%T), want float64", call.Args[7], call.Args[7])
			}
			if got != tc.wantFloat {
				t.Errorf("$8 float_value = %v, want %v (canonicalisation must not rewrite the value)", got, tc.wantFloat)
			}
			for _, idx := range []int{4, 5, 6, 8} {
				if call.Args[idx] != nil {
					t.Errorf("$%d = %v, want nil (exactly one typed column non-null)", idx+1, call.Args[idx])
				}
			}
		})
	}
}

// TestSignalLogWriter_NonNumericKindsUnaffected proves the canonicalisation
// step cannot reach text, bool, timestamp, or enum rows even when the field
// carries catalog metadata.
func TestSignalLogWriter_NonNumericKindsUnaffected(t *testing.T) {
	const vin = "5YJ3E1EA0KF000001"
	emittedAt := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name     string
		field    string
		value    any
		wantKind int16
	}{
		{name: "string", field: "Vin", value: "5YJ3E1EA0KF000001", wantKind: signalLogKindString},
		{name: "bool", field: "BatteryHeaterOn", value: true, wantKind: signalLogKindBool},
		{name: "time", field: "VehicleSpeed", value: emittedAt, wantKind: signalLogKindTime},
		{name: "proto enum", field: "ChargeState", value: ftproto.ShiftState_ShiftStateD, wantKind: signalLogKindEnum},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newSignalLogTestWriter(t, rec)
			if err := w.Write(context.Background(), codec.Atomic{
				Field: tc.field, Value: tc.value, EmittedAt: emittedAt, VehicleID: vin,
			}, router.Entry{Field: tc.field, Destination: router.DestSignalLog}); err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got, ok := rec.calls[0].Args[3].(int16); !ok || got != tc.wantKind {
				t.Errorf("$4 value_kind = %v (%T), want %d", rec.calls[0].Args[3], rec.calls[0].Args[3], tc.wantKind)
			}
		})
	}
}
