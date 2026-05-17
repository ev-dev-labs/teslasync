package codec

import (
	"errors"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// readCoercionMetric returns the current counter value for the
// (field, from) coercion label combo, or 0 if the labeled series has
// not been observed yet. Tests assert on deltas so the suite is
// resilient to other tests touching the same global counter.
func readCoercionMetric(t *testing.T, field, from string) float64 {
	t.Helper()
	c, err := jsonCoercionTotal.GetMetricWith(prometheus.Labels{"field": field, "from": from})
	if err != nil {
		t.Fatalf("jsonCoercionTotal.GetMetricWith(%s,%s): %v", field, from, err)
	}
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("counter.Write: %v", err)
	}
	if m.Counter == nil {
		return 0
	}
	return m.Counter.GetValue()
}

func TestDecodeJSONField_DriverSeatBelt_BoolWire(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{name: "true", body: "true", want: true},
		{name: "false", body: "false", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := readCoercionMetric(t, "DriverSeatBelt", "bool")
			got, err := DecodeJSONField("DriverSeatBelt", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("got %d atoms, want 1", len(got))
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %v (%T) — DB column is BOOLEAN and writer expects bool", got[0].Value, got[0].Value, tc.want, tc.want)
			}
			// bool passthrough: did NOT coerce, counter must NOT increment
			if delta := readCoercionMetric(t, "DriverSeatBelt", "bool") - before; delta != 0 {
				t.Errorf("jsonCoercionTotal{DriverSeatBelt,bool} incremented by %v on passthrough, want 0", delta)
			}
		})
	}
}

func TestDecodeJSONField_DriverSeatBelt_LegacyEnumStringCoercedToBool(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{name: "short-latched", body: `"Latched"`, want: true},
		{name: "short-unlatched", body: `"Unlatched"`, want: false},
		{name: "prefixed-latched", body: `"BuckleStatusLatched"`, want: true},
		{name: "prefixed-unlatched", body: `"BuckleStatusUnlatched"`, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := readCoercionMetric(t, "DriverSeatBelt", "string")
			got, err := DecodeJSONField("DriverSeatBelt", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %v", got[0].Value, got[0].Value, tc.want)
			}
			if delta := readCoercionMetric(t, "DriverSeatBelt", "string") - before; delta != 1 {
				t.Errorf("jsonCoercionTotal{DriverSeatBelt,string} delta = %v, want 1 (legacy enum -> bool is a coercion event)", delta)
			}
		})
	}
}

func TestDecodeJSONField_DriverSeatBelt_AmbiguousEnumDrops(t *testing.T) {
	cases := []string{
		`"Faulted"`,
		`"BuckleStatusFaulted"`,
		`"Unknown"`,
		`"BuckleStatusUnknown"`,
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			got, err := DecodeJSONField("DriverSeatBelt", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("ambiguous seatbelt enum %q must drop, got %v", body, got)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
			if got != nil {
				t.Errorf("got %v atoms on drop, want nil", got)
			}
		})
	}
}

func TestDecodeJSONField_PassengerSeatBelt_SameContract(t *testing.T) {
	// Symmetry test: PassengerSeatBelt uses the identical coercion as
	// DriverSeatBelt. If a future change accidentally diverges them
	// (e.g. a typo in canonicalizeFieldsJSON), this test fails loudly.
	cases := []struct {
		body string
		want bool
	}{
		{body: "true", want: true},
		{body: `"Latched"`, want: true},
		{body: `"BuckleStatusUnlatched"`, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.body, func(t *testing.T) {
			got, err := DecodeJSONField("PassengerSeatBelt", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %v", got[0].Value, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_GpsState_BoolCoercedToString(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{name: "bool-true", body: "true", want: "true"},
		{name: "bool-false", body: "false", want: "false"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := readCoercionMetric(t, "GpsState", "bool")
			got, err := DecodeJSONField("GpsState", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %q — DB column is TEXT and writer expects string", got[0].Value, got[0].Value, tc.want)
			}
			if delta := readCoercionMetric(t, "GpsState", "bool") - before; delta != 1 {
				t.Errorf("jsonCoercionTotal{GpsState,bool} delta = %v, want 1", delta)
			}
		})
	}
}

func TestDecodeJSONField_GpsState_StringPassthrough(t *testing.T) {
	cases := []string{`"DR_GPS_NAV_LIMITED"`, `"GpsLocked"`, `""`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			before := readCoercionMetric(t, "GpsState", "string")
			got, err := DecodeJSONField("GpsState", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			s, ok := got[0].Value.(string)
			if !ok {
				t.Fatalf("Value type = %T, want string passthrough", got[0].Value)
			}
			// strip the JSON quotes from body for comparison
			want := body[1 : len(body)-1]
			if s != want {
				t.Errorf("Value = %q, want %q", s, want)
			}
			if delta := readCoercionMetric(t, "GpsState", "string") - before; delta != 0 {
				t.Errorf("jsonCoercionTotal{GpsState,string} incremented by %v on passthrough, want 0", delta)
			}
		})
	}
}

func TestDecodeJSONField_RearSeatHeaters_StringPassthrough(t *testing.T) {
	cases := []string{`"Present"`, `"None"`, `"OFF"`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			before := readCoercionMetric(t, "RearSeatHeaters", "string")
			got, err := DecodeJSONField("RearSeatHeaters", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			s, ok := got[0].Value.(string)
			if !ok {
				t.Fatalf("Value type = %T, want string", got[0].Value)
			}
			want := body[1 : len(body)-1]
			if s != want {
				t.Errorf("Value = %q, want %q", s, want)
			}
			if delta := readCoercionMetric(t, "RearSeatHeaters", "string") - before; delta != 0 {
				t.Errorf("jsonCoercionTotal{RearSeatHeaters,string} incremented by %v on passthrough, want 0", delta)
			}
		})
	}
}

func TestDecodeJSONField_RearSeatHeaters_NumberCoercedToString(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{name: "int", body: "2", want: "2"},
		{name: "float-trailing-zero", body: "2.0", want: "2"},
		{name: "float-decimal", body: "2.5", want: "2.5"},
		{name: "zero", body: "0", want: "0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := readCoercionMetric(t, "RearSeatHeaters", "number")
			got, err := DecodeJSONField("RearSeatHeaters", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %q", got[0].Value, got[0].Value, tc.want)
			}
			if delta := readCoercionMetric(t, "RearSeatHeaters", "number") - before; delta != 1 {
				t.Errorf("jsonCoercionTotal{RearSeatHeaters,number} delta = %v, want 1", delta)
			}
		})
	}
}

func TestDecodeJSONField_RearSeatHeaters_BoolCoercedToString(t *testing.T) {
	cases := []struct {
		body string
		want string
	}{
		{body: "true", want: "true"},
		{body: "false", want: "false"},
	}
	for _, tc := range cases {
		t.Run(tc.body, func(t *testing.T) {
			got, err := DecodeJSONField("RearSeatHeaters", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %q", got[0].Value, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_CanonicalFields_UnsupportedShapeDrops(t *testing.T) {
	// Object/array bodies have no canonical mapping for any of the
	// four overridden fields — they MUST drop with ErrPayloadDrop so
	// the DLQ captures the bad message instead of silently corrupting
	// the row.
	cases := []struct {
		field string
		body  string
	}{
		{field: "DriverSeatBelt", body: `{"unexpected":"object"}`},
		{field: "DriverSeatBelt", body: `[1,2,3]`},
		{field: "GpsState", body: `{"k":"v"}`},
		{field: "GpsState", body: `42`}, // number for a string|bool field is unmappable
		{field: "RearSeatHeaters", body: `{"k":"v"}`},
		{field: "PassengerSeatBelt", body: `123`}, // number for a bool field is unmappable
	}
	for _, tc := range cases {
		t.Run(tc.field+"/"+tc.body, func(t *testing.T) {
			got, err := DecodeJSONField(tc.field, []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("got nil err for unmappable body, want ErrPayloadDrop wrap (atoms=%v)", got)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
			if got != nil {
				t.Errorf("got %v atoms on drop, want nil", got)
			}
		})
	}
}

func TestDecodeJSONField_CanonicalFields_NullStillInvalid(t *testing.T) {
	// The isJSONNull short-circuit runs BEFORE the override dispatch,
	// so a `null` body is still treated as invalid_value (not a
	// coercion failure) for the four overridden fields. This preserves
	// the ADR-004 "null = producer Value.invalid" contract uniformly.
	for _, field := range []string{"DriverSeatBelt", "PassengerSeatBelt", "GpsState", "RearSeatHeaters"} {
		t.Run(field, func(t *testing.T) {
			got, err := DecodeJSONField(field, []byte("null"), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("null body returned err %v, want nil (treated as invalid_value, not drop)", err)
			}
			if got != nil {
				t.Errorf("got %v atoms on null body, want nil", got)
			}
		})
	}
}

func TestDecodeJSONField_CanonicalFields_PreserveEnvelopeTs(t *testing.T) {
	// The override dispatch runs AFTER unwrapEnvelope, so an envelope
	// `{"value":...,"ts":...}` body must still honor the envelope ts
	// for the overridden fields. Regression guard against the override
	// accidentally short-circuiting the envelope unwrap.
	body := []byte(`{"value":true,"ts":"2026-05-09T07:30:15Z"}`)
	got, err := DecodeJSONField("DriverSeatBelt", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got[0].Value != true {
		t.Errorf("Value = %v, want true", got[0].Value)
	}
	if !got[0].EmittedAt.Equal(envelopeTs) {
		t.Errorf("EmittedAt = %v, want envelope %v", got[0].EmittedAt, envelopeTs)
	}
}

// TestCanonicalizeProtoFieldValue_SeatBeltStringToBool covers the
// proto-batch path: protomodel.DecodeDatum for a BuckleStatusValue
// proto variant returns a string ("Latched"/"Unlatched") via
// strings.TrimPrefix, but the destination BOOLEAN column needs bool.
// Without this canonicalisation the snapshot writer would attempt to
// bind a string into the BOOLEAN driver_seat_belt column and fail.
func TestCanonicalizeProtoFieldValue_SeatBeltStringToBool(t *testing.T) {
	cases := []struct {
		field string
		in    any
		want  any
	}{
		{field: "DriverSeatBelt", in: "Latched", want: true},
		{field: "DriverSeatBelt", in: "Unlatched", want: false},
		{field: "DriverSeatBelt", in: true, want: true},
		{field: "PassengerSeatBelt", in: "Latched", want: true},
		{field: "GpsState", in: true, want: "true"},
		{field: "GpsState", in: "GpsLocked", want: "GpsLocked"},
		{field: "RearSeatHeaters", in: float32(2.5), want: "2.5"},
		{field: "RearSeatHeaters", in: int32(0), want: "0"},
	}
	for _, tc := range cases {
		t.Run(tc.field, func(t *testing.T) {
			got, err := canonicalizeProtoFieldValue(tc.field, tc.in)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Errorf("canonicalizeProtoFieldValue(%q, %v) = %v (%T), want %v (%T)", tc.field, tc.in, got, got, tc.want, tc.want)
			}
		})
	}
}

func TestCanonicalizeProtoFieldValue_PassthroughUnknownFields(t *testing.T) {
	// Fields NOT in canonicalizeFieldsProto must be passed through
	// untouched so the proto-batch path remains zero-overhead for
	// the ~280 unaffected signals.
	cases := []struct {
		field string
		in    any
	}{
		{field: "Soc", in: float32(65.5)},
		{field: "VehicleSpeed", in: float32(32.7)},
		{field: "ChargeState", in: "Charging"},
		{field: "DCDCEnable", in: true},
	}
	for _, tc := range cases {
		t.Run(tc.field, func(t *testing.T) {
			got, err := canonicalizeProtoFieldValue(tc.field, tc.in)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.in {
				t.Errorf("canonicalizeProtoFieldValue(%q, %v) = %v, want passthrough %v", tc.field, tc.in, got, tc.in)
			}
		})
	}
}

func TestCanonicalizeProtoFieldValue_AmbiguousSeatBeltErrors(t *testing.T) {
	// The proto path must surface ambiguous BuckleStatus variants
	// (Faulted/Unknown/etc.) as errors so decodePayload drops the
	// Datum and bumps invalidValuesTotal — the same channel the
	// strict protomodel.ErrInvalid takes.
	for _, in := range []string{"Faulted", "BuckleStatusUnknown", "BuckleStatusFaulted"} {
		t.Run(in, func(t *testing.T) {
			got, err := canonicalizeProtoFieldValue("DriverSeatBelt", in)
			if err == nil {
				t.Fatalf("got %v, want error for ambiguous BuckleStatus %q", got, in)
			}
		})
	}
}

func TestCanonicalizeFieldValue_PassthroughForNonCanonicalField(t *testing.T) {
	// Fields outside the override set return (input, false, nil) so
	// the function is safe to invoke speculatively from either path.
	got, coerced, err := canonicalizeFieldValue("Soc", float32(65.5))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if coerced {
		t.Errorf("coerced = true, want false for non-canonical field")
	}
	if got != float32(65.5) {
		t.Errorf("got = %v, want passthrough 65.5", got)
	}
}

func TestCoercionFromLabel(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{in: true, want: "bool"},
		{in: false, want: "bool"},
		{in: "Latched", want: "string"},
		{in: float64(1), want: "number"},
		{in: float32(1), want: "number"},
		{in: int32(1), want: "number"},
		{in: int64(1), want: "number"},
		{in: int(1), want: "number"},
		{in: map[string]any{}, want: "other"},
		{in: nil, want: "other"},
	}
	for _, tc := range cases {
		got := coercionFromLabel(tc.in)
		if got != tc.want {
			t.Errorf("coercionFromLabel(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ============================================================
// Wave 2: HvacAutoMode / HvacPower / HvacFanStatus
// Added after the audit (tmp/audit_signal_types) found these as the
// same Enum→BOOLEAN / Float→TEXT pattern that bit DriverSeatBelt /
// RearSeatHeaters in production. Architect-reviewed in rubber-duck
// session "codec-audit-findings".
// ============================================================

func TestDecodeJSONField_HvacAutoMode_EnumToBool(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{name: "on-short", body: `"On"`, want: true},
		{name: "on-prefixed", body: `"HvacAutoModeStateOn"`, want: true},
		{name: "override-short-is-false", body: `"Override"`, want: false},
		{name: "override-prefixed-is-false", body: `"HvacAutoModeStateOverride"`, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField("HvacAutoMode", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %v — architect: Override means user has taken manual control, NOT auto-active", got[0].Value, got[0].Value, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_HvacAutoMode_BoolPassthrough(t *testing.T) {
	got, err := DecodeJSONField("HvacAutoMode", []byte("true"), jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got[0].Value != true {
		t.Errorf("Value = %v, want true (bool passthrough)", got[0].Value)
	}
}

func TestDecodeJSONField_HvacAutoMode_UnknownDrops(t *testing.T) {
	for _, body := range []string{`"Unknown"`, `"HvacAutoModeStateUnknown"`, `"Manual"`} {
		t.Run(body, func(t *testing.T) {
			got, err := DecodeJSONField("HvacAutoMode", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("unmappable HvacAutoMode value %q must drop, got %v", body, got)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestDecodeJSONField_HvacPower_EnumToBool(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{name: "off", body: `"Off"`, want: false},
		{name: "off-prefixed", body: `"HvacPowerStateOff"`, want: false},
		{name: "on", body: `"On"`, want: true},
		{name: "precondition", body: `"Precondition"`, want: true},
		{name: "overheat-protect", body: `"OverheatProtect"`, want: true},
		{name: "precondition-prefixed", body: `"HvacPowerStatePrecondition"`, want: true},
		{name: "overheat-prefixed", body: `"HvacPowerStateOverheatProtect"`, want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField("HvacPower", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %v — column means 'HVAC powered/running', not 'user-requested'", got[0].Value, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_HvacPower_BoolPassthrough(t *testing.T) {
	cases := []struct {
		body string
		want bool
	}{
		{body: "true", want: true},
		{body: "false", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.body, func(t *testing.T) {
			got, err := DecodeJSONField("HvacPower", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %v", got[0].Value, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_HvacPower_UnknownDrops(t *testing.T) {
	for _, body := range []string{`"Unknown"`, `"HvacPowerStateUnknown"`, `"Faulted"`} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeJSONField("HvacPower", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("unmappable HvacPower value %q must drop", body)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestDecodeJSONField_HvacFanStatus_StringPassthrough(t *testing.T) {
	for _, body := range []string{`"Off"`, `"Low"`, `"High"`, `""`} {
		t.Run(body, func(t *testing.T) {
			got, err := DecodeJSONField("HvacFanStatus", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			s, ok := got[0].Value.(string)
			if !ok {
				t.Fatalf("Value type = %T, want string", got[0].Value)
			}
			want := body[1 : len(body)-1]
			if s != want {
				t.Errorf("Value = %q, want %q", s, want)
			}
		})
	}
}

func TestDecodeJSONField_HvacFanStatus_NumberToString(t *testing.T) {
	cases := []struct {
		body string
		want string
	}{
		{body: "0", want: "0"},
		{body: "5", want: "5"},
		{body: "10", want: "10"},
		{body: "5.5", want: "5.5"},
	}
	for _, tc := range cases {
		t.Run(tc.body, func(t *testing.T) {
			before := readCoercionMetric(t, "HvacFanStatus", "number")
			got, err := DecodeJSONField("HvacFanStatus", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %q", got[0].Value, tc.want)
			}
			if delta := readCoercionMetric(t, "HvacFanStatus", "number") - before; delta != 1 {
				t.Errorf("jsonCoercionTotal{HvacFanStatus,number} delta = %v, want 1", delta)
			}
		})
	}
}

func TestDecodeJSONField_HvacFanStatus_BoolUnsupported(t *testing.T) {
	// Architect: HvacFanStatus deliberately does NOT support bool→string
	// because there is no observed Tesla wire shape that emits bool for
	// this field — adding that coercion would weaken the schema for no
	// benefit. If a bool ever arrives it MUST drop loudly so the operator
	// is alerted.
	for _, body := range []string{"true", "false"} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeJSONField("HvacFanStatus", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("bool body must drop for HvacFanStatus (no defined coercion)")
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestCanonicalizeProtoFieldValue_HvacFamily(t *testing.T) {
	// Symmetric coverage for the proto-batch path so a future codec
	// change that breaks the proto-side canonicalisation fails here.
	cases := []struct {
		field string
		in    any
		want  any
	}{
		{field: "HvacAutoMode", in: "On", want: true},
		{field: "HvacAutoMode", in: "Override", want: false},
		{field: "HvacAutoMode", in: true, want: true},
		{field: "HvacPower", in: "Off", want: false},
		{field: "HvacPower", in: "On", want: true},
		{field: "HvacPower", in: "Precondition", want: true},
		{field: "HvacFanStatus", in: "Off", want: "Off"},
		{field: "HvacFanStatus", in: float32(5), want: "5"},
		// Wave 3 — CabinOverheatProtectionTemperatureLimit, post-000210
		// schema migration. Proto-batch path passes through the trimmed
		// bare label, JSON path may deliver either shape.
		{field: "CabinOverheatProtectionTemperatureLimit", in: "Low", want: "Low"},
		{field: "CabinOverheatProtectionTemperatureLimit", in: "Medium", want: "Medium"},
		{field: "CabinOverheatProtectionTemperatureLimit", in: "High", want: "High"},
		{field: "CabinOverheatProtectionTemperatureLimit", in: "ClimateOverheatProtectionTempLimitHigh", want: "High"},
	}
	for _, tc := range cases {
		t.Run(tc.field, func(t *testing.T) {
			got, err := canonicalizeProtoFieldValue(tc.field, tc.in)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Errorf("canonicalizeProtoFieldValue(%q, %v) = %v (%T), want %v (%T)", tc.field, tc.in, got, got, tc.want, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_LabelPassthrough(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{name: "low", body: `"Low"`, want: "Low"},
		{name: "medium", body: `"Medium"`, want: "Medium"},
		{name: "high", body: `"High"`, want: "High"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("got %d atoms, want 1", len(got))
			}
			s, ok := got[0].Value.(string)
			if !ok {
				t.Fatalf("Value type = %T, want string", got[0].Value)
			}
			if s != tc.want {
				t.Errorf("Value = %q, want %q", s, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_PrefixedTrimmed(t *testing.T) {
	cases := []struct {
		body string
		want string
	}{
		{body: `"ClimateOverheatProtectionTempLimitLow"`, want: "Low"},
		{body: `"ClimateOverheatProtectionTempLimitMedium"`, want: "Medium"},
		{body: `"ClimateOverheatProtectionTempLimitHigh"`, want: "High"},
	}
	for _, tc := range cases {
		t.Run(tc.body, func(t *testing.T) {
			before := readCoercionMetric(t, "CabinOverheatProtectionTemperatureLimit", "string")
			got, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v, want %q (prefix should be trimmed)", got[0].Value, tc.want)
			}
			if delta := readCoercionMetric(t, "CabinOverheatProtectionTemperatureLimit", "string") - before; delta != 1 {
				t.Errorf("jsonCoercionTotal{CabinOverheat...,string} delta = %v, want 1 (prefixed form is a coercion)", delta)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_UnknownDrops(t *testing.T) {
	// Architect: "Unknown" must drop — same rule as HvacAutoMode and
	// HvacPower. The TEXT column could hold the literal "Unknown" but
	// that would pollute "current state" dashboards forever; the absence
	// of a usable value is correctly modelled as a row-without-update.
	bodies := []string{
		`"Unknown"`,
		`"ClimateOverheatProtectionTempLimitUnknown"`,
		`"Medi"`,         // partial — would not have a storage mapping
		`"unknown"`,      // wrong case
		`"VeryHigh"`,     // not in the enum
	}
	for _, body := range bodies {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("unmappable CabinOverheatProtectionTemperatureLimit value %q must drop", body)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_NumberDrops(t *testing.T) {
	// Architect: number wire shape (legacy Celsius assumption) must
	// drop. Stringifying ("35") would mix two semantic domains in the
	// same TEXT column. Operators see drift via jsonDecodeErrorsTotal
	// not jsonCoercionTotal.
	for _, body := range []string{"35", "40.5", "0"} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("numeric CabinOverheatProtectionTemperatureLimit value %q must drop", body)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_BoolDrops(t *testing.T) {
	for _, body := range []string{"true", "false"} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte(body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("bool CabinOverheatProtectionTemperatureLimit value %q must drop", body)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Errorf("err %v does not wrap ErrPayloadDrop", err)
			}
		})
	}
}

func TestDecodeJSONField_CabinOverheatLimit_NullIsSilentDrop(t *testing.T) {
	// Per the JSON path's isJSONNull early-return contract: null bodies
	// produce (nil, nil) — no atoms emitted, no payload-drop error.
	// Same behaviour as every other override and the strict switch.
	atoms, err := DecodeJSONField("CabinOverheatProtectionTemperatureLimit", []byte("null"), jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("null body must not error, got %v", err)
	}
	if atoms != nil {
		t.Fatalf("null body must emit no atoms, got %v", atoms)
	}
}
