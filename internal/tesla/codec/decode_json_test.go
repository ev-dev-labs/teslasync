package codec

import (
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

var (
	jsonFixedVIN = "5YJ3E1EA0NF000001"
	jsonFixedTs  = time.Date(2026, 5, 9, 8, 0, 0, 0, time.UTC)
	envelopeTs   = time.Date(2026, 5, 9, 7, 30, 15, 0, time.UTC)
)

func TestDecodeJSONField_AtomicScalars(t *testing.T) {
	tests := []struct {
		name      string
		field     string
		body      string
		wantField string
		wantValue any
	}{
		{name: "float", field: "Soc", body: "65.5", wantField: "Soc", wantValue: float32(65.5)},
		{name: "bool", field: "DCDCEnable", body: "true", wantField: "DCDCEnable", wantValue: true},
		{name: "string", field: "GpsState", body: `"DR_GPS_NAV_LIMITED"`, wantField: "GpsState", wantValue: "DR_GPS_NAV_LIMITED"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField(tc.field, []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("got %d atoms, want 1", len(got))
			}
			a := got[0]
			if a.Field != tc.wantField {
				t.Errorf("Field = %q, want %q", a.Field, tc.wantField)
			}
			if a.Value != tc.wantValue {
				t.Errorf("Value = %v (%T), want %v (%T)", a.Value, a.Value, tc.wantValue, tc.wantValue)
			}
			if !a.EmittedAt.Equal(jsonFixedTs) {
				t.Errorf("EmittedAt = %v, want %v", a.EmittedAt, jsonFixedTs)
			}
			if a.VehicleID != jsonFixedVIN {
				t.Errorf("VehicleID = %q, want %q", a.VehicleID, jsonFixedVIN)
			}
			if a.IngestOrigin != IngestOriginUnknown {
				t.Errorf("IngestOrigin = %q, want unknown before transport stamping", a.IngestOrigin)
			}
			if a.SourceEmittedAt != nil {
				t.Errorf("bare JSON SourceEmittedAt = %v, want nil (receipt fallback is not source evidence)", a.SourceEmittedAt)
			}
		})
	}
}

// TestDecodeJSONField_DispatcherCoversAllValueKinds exercises the
// dispatcher branches that no real Field declares today (Int32, Int64,
// Double). The code paths are kept for forward compatibility — a future
// proto bump adding an integer Field MUST decode through DecodeJSONField
// without a code change — so we synthesise a SignalMeta entry, restore
// it in t.Cleanup, and assert each branch returns the expected typed
// Atomic.Value. Without this test, those defensive branches would rot
// silently until the day they were actually needed.
func TestDecodeJSONField_DispatcherCoversAllValueKinds(t *testing.T) {
	cases := []struct {
		name      string
		field     string
		valueKind protomodel.ValueKind
		body      string
		want      any
	}{
		{name: "int32", field: "__synthetic_int32__", valueKind: protomodel.ValueKindInt32, body: "240", want: int32(240)},
		{name: "int64", field: "__synthetic_int64__", valueKind: protomodel.ValueKindInt64, body: "9223372036854775000", want: int64(9223372036854775000)},
		{name: "double", field: "__synthetic_double__", valueKind: protomodel.ValueKindDouble, body: "3.14159265358979", want: float64(3.14159265358979)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			meta := &protomodel.SignalMeta{Field: tc.field, ValueKind: tc.valueKind}
			protomodel.SignalsByName[tc.field] = meta
			t.Cleanup(func() { delete(protomodel.SignalsByName, tc.field) })
			got, err := DecodeJSONField(tc.field, []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("got %d atoms, want 1", len(got))
			}
			if got[0].Value != tc.want {
				t.Errorf("Value = %v (%T), want %v (%T)", got[0].Value, got[0].Value, tc.want, tc.want)
			}
		})
	}
}

// TestDecodeJSONField_EnumStripsPrefix exercises the EnumStringPrefix path
// for two enums whose .String() prefix is irregular: ChargingState.String()
// emits "ChargeStateCharging" but EnumTypeName="ChargingState"; the codegen
// records the actual longest-common-prefix ("ChargeState") so the trim
// produces the canonical short string "Charging" instead of corruption.
func TestDecodeJSONField_EnumStripsPrefix(t *testing.T) {
	tests := []struct {
		name  string
		field string
		body  string
		want  string
	}{
		{name: "shift-state", field: "Gear", body: `"ShiftStateD"`, want: "D"},
		{name: "charge-state", field: "ChargeState", body: `"ChargeStateCharging"`, want: "Charging"},
		{name: "detailed-charge", field: "DetailedChargeState", body: `"DetailedChargeStateComplete"`, want: "Complete"},
		{name: "bms-state", field: "BMSState", body: `"BMSStateStandby"`, want: "Standby"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField(tc.field, []byte(tc.body), jsonFixedVIN, jsonFixedTs)
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
				t.Errorf("Value = %q, want %q (canonical short form per Rule 11)", s, tc.want)
			}
		})
	}
}

func TestDecodeJSONField_LocationCompoundLowercaseKeys(t *testing.T) {
	got, err := DecodeJSONField("Location", []byte(`{"latitude":37.7749,"longitude":-122.4194}`), jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d atoms, want 2", len(got))
	}
	wantLat := float64(37.7749)
	wantLng := float64(-122.4194)
	if got[0].Field != "LocationLatitude" || got[0].Value != wantLat {
		t.Errorf("got[0] = (%q, %v), want (LocationLatitude, %v)", got[0].Field, got[0].Value, wantLat)
	}
	if got[1].Field != "LocationLongitude" || got[1].Value != wantLng {
		t.Errorf("got[1] = (%q, %v), want (LocationLongitude, %v)", got[1].Field, got[1].Value, wantLng)
	}
}

// TestDecodeJSONField_LocationPrefixesByField asserts that the same
// LocationValue carried by OriginLocation / DestinationLocation maps to
// distinct flattened field names so a Payload that contains all three
// can never collide downstream.
func TestDecodeJSONField_LocationPrefixesByField(t *testing.T) {
	body := []byte(`{"latitude":1.0,"longitude":2.0}`)
	for _, field := range []string{"Location", "OriginLocation", "DestinationLocation"} {
		got, err := DecodeJSONField(field, body, jsonFixedVIN, jsonFixedTs)
		if err != nil {
			t.Fatalf("%s: %v", field, err)
		}
		if len(got) != 2 {
			t.Fatalf("%s: got %d atoms, want 2", field, len(got))
		}
		if got[0].Field != field+"Latitude" || got[1].Field != field+"Longitude" {
			t.Errorf("%s: got (%q,%q), want (%sLatitude,%sLongitude)", field, got[0].Field, got[1].Field, field, field)
		}
	}
}

func TestDecodeJSONField_DoorStateStringWrapped(t *testing.T) {
	// DoorState arrives over MQTT as a JSON-quoted string containing
	// JSON: Tesla's getDatumValue returns the raw string verbatim, then
	// json.Marshal of that string produces a doubly-encoded payload.
	body := []byte(`"{\"DriverFront\":true,\"DriverRear\":false,\"PassengerFront\":false,\"PassengerRear\":true,\"FrontTrunk\":false,\"RearTrunk\":true}"`)
	got, err := DecodeJSONField("DoorState", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 6 {
		t.Fatalf("got %d atoms, want 6", len(got))
	}
	want := map[string]bool{
		"DoorStateDriverFront":    true,
		"DoorStateDriverRear":     false,
		"DoorStatePassengerFront": false,
		"DoorStatePassengerRear":  true,
		"DoorStateFrontTrunk":     false,
		"DoorStateRearTrunk":      true,
	}
	for _, a := range got {
		exp, ok := want[a.Field]
		if !ok {
			t.Errorf("unexpected field %q", a.Field)
			continue
		}
		if a.Value != exp {
			t.Errorf("%s = %v, want %v", a.Field, a.Value, exp)
		}
	}
}

func TestDecodeJSONField_TireLocationSnakeCaseKeys(t *testing.T) {
	// Tesla's getProtoValue fallback emits proto field names verbatim,
	// which is lower_snake_case for TireLocation.
	body := []byte(`{"front_left":true,"front_right":false,"rear_left":true,"rear_right":false}`)
	got, err := DecodeJSONField("TpmsHardWarnings", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 10 {
		t.Fatalf("got %d atoms, want 10", len(got))
	}
	byField := map[string]bool{}
	for _, a := range got {
		byField[a.Field] = a.Value.(bool)
	}
	if !byField["TpmsHardWarningsFrontLeft"] || byField["TpmsHardWarningsFrontRight"] || !byField["TpmsHardWarningsRearLeft"] || byField["TpmsHardWarningsRearRight"] {
		t.Errorf("snake-case keys not mapped correctly: %#v", byField)
	}
}

func TestDecodeJSONField_TireLocationGoCasedKeys(t *testing.T) {
	// Go-cased shape (test fixtures + any future first-class typed
	// json.Marshal of protomodel.TireLocation).
	body := []byte(`{"FrontLeft":true,"FrontRight":false,"RearLeft":true,"RearRight":false}`)
	got, err := DecodeJSONField("TpmsHardWarnings", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	byField := map[string]bool{}
	for _, a := range got {
		byField[a.Field] = a.Value.(bool)
	}
	if !byField["TpmsHardWarningsFrontLeft"] || byField["TpmsHardWarningsFrontRight"] || !byField["TpmsHardWarningsRearLeft"] || byField["TpmsHardWarningsRearRight"] {
		t.Errorf("Go-cased keys not mapped correctly: %#v", byField)
	}
}

func TestDecodeJSONField_ScheduledChargingStartTime(t *testing.T) {
	body := []byte(`"{\"hour\":7,\"minute\":30,\"second\":0}"`)
	got, err := DecodeJSONField("ScheduledChargingStartTime", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d atoms, want 1", len(got))
	}
	if got[0].Field != "ScheduledChargingStartTime" {
		t.Errorf("Field = %q, want ScheduledChargingStartTime", got[0].Field)
	}
	gotTime, ok := got[0].Value.(time.Time)
	if !ok {
		t.Fatalf("Value type = %T, want time.Time", got[0].Value)
	}
	want := time.Date(2026, 5, 9, 7, 30, 0, 0, time.UTC)
	if !gotTime.Equal(want) {
		t.Errorf("Value = %v, want %v", gotTime, want)
	}
}

func TestDecodeJSONField_NullDropsAsInvalid(t *testing.T) {
	got, err := DecodeJSONField("Soc", []byte("null"), jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != nil {
		t.Errorf("got %v atoms, want nil", got)
	}
}

func TestDecodeJSONField_UnknownFieldDropsCleanly(t *testing.T) {
	got, err := DecodeJSONField("ThisFieldDoesNotExist", []byte("42"), jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != nil {
		t.Errorf("got %v atoms, want nil for unknown field", got)
	}
}

func TestDecodeJSONField_ParseFailureWrapsErrPayloadDrop(t *testing.T) {
	tests := []struct {
		name  string
		field string
		body  string
	}{
		{name: "string-where-bool", field: "DCDCEnable", body: `"yes"`},
		{name: "object-where-float", field: "Soc", body: `{"some":1}`},
		{name: "garbage", field: "Soc", body: `not json`},
		{name: "location-missing-shape", field: "Location", body: `[1,2]`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeJSONField(tc.field, []byte(tc.body), jsonFixedVIN, jsonFixedTs)
			if err == nil {
				t.Fatalf("got nil err, want one wrapping ErrPayloadDrop (atoms=%v)", got)
			}
			if !errors.Is(err, ErrPayloadDrop) {
				t.Fatalf("err %v does not wrap ErrPayloadDrop", err)
			}
			if got != nil {
				t.Errorf("got %v atoms on failure, want nil", got)
			}
		})
	}
}

func TestDecodeJSONField_EnvelopeOverridesTimestamp(t *testing.T) {
	body := []byte(`{"value":65.5,"ts":"2026-05-09T07:30:15Z"}`)
	got, err := DecodeJSONField("Soc", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d atoms, want 1", len(got))
	}
	if got[0].Value != float32(65.5) {
		t.Errorf("Value = %v, want 65.5", got[0].Value)
	}
	if !got[0].EmittedAt.Equal(envelopeTs) {
		t.Errorf("EmittedAt = %v, want %v (envelope ts must override fallback)", got[0].EmittedAt, envelopeTs)
	}
	if got[0].SourceEmittedAt == nil || !got[0].SourceEmittedAt.Equal(envelopeTs) {
		t.Errorf("SourceEmittedAt = %v, want envelope source timestamp %v", got[0].SourceEmittedAt, envelopeTs)
	}
}

func TestDecodeJSONField_EnvelopeWithoutTsKeepsFallback(t *testing.T) {
	body := []byte(`{"value":65.5}`)
	got, err := DecodeJSONField("Soc", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !got[0].EmittedAt.Equal(jsonFixedTs) {
		t.Errorf("EmittedAt = %v, want fallback %v", got[0].EmittedAt, jsonFixedTs)
	}
	if got[0].SourceEmittedAt != nil {
		t.Errorf("SourceEmittedAt = %v, want nil when envelope has no ts", got[0].SourceEmittedAt)
	}
}

// TestDecodeJSONField_LocationNotEnvelope asserts that a Location compound
// body (which is also a JSON object) is NOT mistaken for an envelope: it
// has no top-level "value" key, so the unwrapper passes it through and the
// compound dispatcher takes over. This is the core safety invariant for
// the envelope detection rule.
func TestDecodeJSONField_LocationNotEnvelope(t *testing.T) {
	body := []byte(`{"latitude":1.5,"longitude":2.5}`)
	got, err := DecodeJSONField("Location", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d atoms, want 2 (Location compound, not envelope)", len(got))
	}
}

func TestDecodeJSONField_EnvelopeBadTsWrapsErrPayloadDrop(t *testing.T) {
	body := []byte(`{"value":65.5,"ts":"not-a-time"}`)
	got, err := DecodeJSONField("Soc", body, jsonFixedVIN, jsonFixedTs)
	if err == nil {
		t.Fatalf("got nil err for bad envelope ts, want ErrPayloadDrop wrap (atoms=%v)", got)
	}
	if !errors.Is(err, ErrPayloadDrop) {
		t.Fatalf("err %v does not wrap ErrPayloadDrop", err)
	}
	if !errors.Is(err, ErrSourceTimestampInvalid) {
		t.Fatalf("err %v does not wrap ErrSourceTimestampInvalid", err)
	}
}

func TestDecodeJSONField_EnvelopeRejectsImplausiblyFutureTimestamp(t *testing.T) {
	future := jsonFixedTs.Add(maxSourceTimestampFutureSkew + time.Second)
	body := []byte(`{"value":65.5,"ts":"` + future.Format(time.RFC3339Nano) + `"}`)

	got, err := DecodeJSONField("Soc", body, jsonFixedVIN, jsonFixedTs)
	if err == nil {
		t.Fatalf("got nil err for future envelope timestamp (atoms=%v)", got)
	}
	if !errors.Is(err, ErrPayloadDrop) || !errors.Is(err, ErrSourceTimestampInvalid) {
		t.Fatalf("err %v must wrap ErrPayloadDrop and ErrSourceTimestampInvalid", err)
	}
}

func TestDecodeJSONField_EnvelopeRejectsZeroTimestamp(t *testing.T) {
	got, err := DecodeJSONField(
		"Soc",
		[]byte(`{"value":65.5,"ts":"0001-01-01T00:00:00Z"}`),
		jsonFixedVIN,
		jsonFixedTs,
	)
	if err == nil {
		t.Fatalf("got nil err for zero envelope timestamp (atoms=%v)", got)
	}
	if !errors.Is(err, ErrPayloadDrop) || !errors.Is(err, ErrSourceTimestampInvalid) {
		t.Fatalf("err %v must wrap ErrPayloadDrop and ErrSourceTimestampInvalid", err)
	}
}

func TestDecodeJSONField_EnvelopeAcceptsOldTimestamp(t *testing.T) {
	old := jsonFixedTs.Add(-7 * 24 * time.Hour)
	body := []byte(`{"value":65.5,"ts":"` + old.Format(time.RFC3339Nano) + `"}`)

	got, err := DecodeJSONField("Soc", body, jsonFixedVIN, jsonFixedTs)
	if err != nil {
		t.Fatalf("DecodeJSONField() old source timestamp error = %v", err)
	}
	if len(got) != 1 || !got[0].EmittedAt.Equal(old) {
		t.Fatalf("EmittedAt = %v, want old source timestamp %v", got, old)
	}
}
