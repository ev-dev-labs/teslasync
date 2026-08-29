package codec

import (
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// makeMixedPayload builds a Payload with one entry from each broad
// category the codec must handle: a happy scalar, a happy enum, a
// fully-populated proto compound (Location), a JSON-shaped string
// compound (DoorState), an invalid-flagged Datum (must be dropped), and
// an unset-Value Datum (must be dropped). The resulting slice is the
// canonical fixture for TestDecode_MixedPayload below; sharing it across
// the structural and contract tests keeps the expectations in one place.
func makeMixedPayload() *ftproto.Payload {
	return &ftproto.Payload{
		Vin:       "5YJ3E1EA0KF000999",
		CreatedAt: timestamppb.New(time.Date(2025, time.April, 10, 9, 15, 30, 0, time.UTC)),
		Data: []*ftproto.Datum{
			{
				// happy scalar
				Key:   ftproto.Field_VehicleSpeed,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 42.5}},
			},
			{
				// happy enum: the Field key is "Gear". The proto wire
				// value is the typed ftproto.ShiftState enum, but the
				// codec canonicalizes it to a short string ("D") at
				// the SINGLE conversion point — see protomodel.DecodeValue.
				// The atomic carries the canonical short string, NOT
				// the typed ftproto.* value.
				Key:   ftproto.Field_Gear,
				Value: &ftproto.Value{Value: &ftproto.Value_ShiftStateValue{ShiftStateValue: ftproto.ShiftState_ShiftStateD}},
			},
			{
				// proto compound: Location -> 2 atomic children
				Key: ftproto.Field_Location,
				Value: &ftproto.Value{Value: &ftproto.Value_LocationValue{
					LocationValue: &ftproto.LocationValue{Latitude: 37.7749, Longitude: -122.4194},
				}},
			},
			{
				// JSON string compound: DoorState -> 6 atomic children
				Key: ftproto.Field_DoorState,
				Value: &ftproto.Value{Value: &ftproto.Value_StringValue{
					StringValue: `{"DriverFront":true,"DriverRear":false,"PassengerFront":false,"PassengerRear":true,"FrontTrunk":false,"RearTrunk":true}`,
				}},
			},
			{
				// invalid: must be dropped, NOT propagated as zero
				Key:   ftproto.Field_BatteryLevel,
				Value: &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: true}},
			},
			{
				// unset oneof: must be dropped
				Key:   ftproto.Field_RatedRange,
				Value: &ftproto.Value{},
			},
		},
	}
}

// TestDecode_MixedPayload is the headline integration test: a Payload
// that exercises every codec dispatch path round-trips through
// proto.Marshal -> codec.Decode and yields exactly the expected atomic
// set. The invalid-flagged and unset-oneof Datum entries must be dropped
// (leaving 1 + 1 + 2 + 6 = 10 atomic outputs from 6 inputs) and the
// dropped fields must not appear under any guise in the output.
func TestDecode_MixedPayload(t *testing.T) {
	p := makeMixedPayload()
	bytes, err := proto.Marshal(p)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}

	atoms, err := Decode(bytes)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}

	wantNames := []string{
		"VehicleSpeed",
		"Gear",
		"LocationLatitude", "LocationLongitude",
		"DoorStateDriverFront", "DoorStateDriverRear",
		"DoorStatePassengerFront", "DoorStatePassengerRear",
		"DoorStateFrontTrunk", "DoorStateRearTrunk",
	}
	sort.Strings(wantNames)
	gotNames := fieldNames(atoms)
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("Decode field set =\n  %v\nwant =\n  %v", gotNames, wantNames)
	}

	// Dropped Datum entries must NOT have leaked through under their
	// original Field name.
	for _, dropped := range []string{"BatteryLevel", "RatedRange"} {
		for _, a := range atoms {
			if a.Field == dropped {
				t.Errorf("invalid/unset Datum %q leaked into atomic output", dropped)
			}
		}
	}

	// Every atomic must carry the Payload-level VIN and CreatedAt.
	wantTs := time.Date(2025, time.April, 10, 9, 15, 30, 0, time.UTC)
	for _, a := range atoms {
		if a.VehicleID != "5YJ3E1EA0KF000999" {
			t.Errorf("atom %q VehicleID = %q, want 5YJ3E1EA0KF000999", a.Field, a.VehicleID)
		}
		if !a.EmittedAt.Equal(wantTs) {
			t.Errorf("atom %q EmittedAt = %v, want %v", a.Field, a.EmittedAt, wantTs)
		}
		if a.IngestOrigin != IngestOriginUnknown {
			t.Errorf("atom %q IngestOrigin = %q, want unknown before a transport stamp", a.Field, a.IngestOrigin)
		}
		if a.SourceEmittedAt == nil || !a.SourceEmittedAt.Equal(wantTs) {
			t.Errorf("atom %q SourceEmittedAt = %v, want %v", a.Field, a.SourceEmittedAt, wantTs)
		}
	}

	// Spot-check the scalar carry-throughs preserve their decoded type.
	for _, a := range atoms {
		switch a.Field {
		case "VehicleSpeed":
			if v, ok := a.Value.(float32); !ok || v != 42.5 {
				t.Errorf("VehicleSpeed = %v (%T), want float32(42.5)", a.Value, a.Value)
			}
		case "Gear":
			if v, ok := a.Value.(string); !ok || v != "D" {
				t.Errorf("Gear = %v (%T), want string \"D\" (codec canonicalizes ShiftState_ShiftStateD)", a.Value, a.Value)
			}
		case "LocationLatitude":
			if v, ok := a.Value.(float64); !ok || v != 37.7749 {
				t.Errorf("LocationLatitude = %v (%T), want float64(37.7749)", a.Value, a.Value)
			}
		}
	}
}

// TestDecode_AtomicValuesAreFlat is the structural enforcement of the
// ADR-004 #4 contract: nothing in the codec output ever carries a
// protomodel compound type. If a future change accidentally bypasses the
// flatten dispatch (or returns a typed compound from a new code path)
// this test fires immediately. It uses reflect rather than a static
// type-switch so a future-added compound (e.g. a new Window struct) is
// still caught without a test edit.
func TestDecode_AtomicValuesAreFlat(t *testing.T) {
	p := makeMixedPayload()
	bytes, err := proto.Marshal(p)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}
	atoms, err := Decode(bytes)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}

	forbidden := map[reflect.Type]string{
		reflect.TypeOf(protomodel.Location{}):                   "protomodel.Location",
		reflect.TypeOf(protomodel.Doors{}):                      "protomodel.Doors",
		reflect.TypeOf(protomodel.TireLocation{}):               "protomodel.TireLocation",
		reflect.TypeOf(protomodel.Time{}):                       "protomodel.Time",
		reflect.TypeOf(protomodel.DoorState{}):                  "protomodel.DoorState",
		reflect.TypeOf(protomodel.ScheduledChargingStartTime{}): "protomodel.ScheduledChargingStartTime",
		reflect.TypeOf(protomodel.ScheduledDepartureTime{}):     "protomodel.ScheduledDepartureTime",
	}
	for _, a := range atoms {
		if a.Value == nil {
			continue
		}
		gotType := reflect.TypeOf(a.Value)
		if name, bad := forbidden[gotType]; bad {
			t.Errorf("atom %q has compound type %s in Value — codec must flatten before emitting",
				a.Field, name)
		}
	}
}

// TestDecode_MalformedBytesError is the redelivery contract per ADR-004:
// the OUTER proto.Unmarshal failure is the only error Decode propagates.
// The MQTT handler upstream reads this as "malformed bytes" and may
// trigger a redelivery; per-Datum failures must NOT do so (covered in
// TestDecode_MixedPayload).
func TestDecode_MalformedBytesError(t *testing.T) {
	got, err := Decode([]byte{0xff, 0xff, 0xff, 0xff})
	if err == nil {
		t.Fatalf("Decode on malformed bytes returned nil err")
	}
	if got != nil {
		t.Errorf("Decode on malformed bytes returned non-nil atoms = %v", got)
	}
}

// TestDecode_EmptyPayloadIsEmptySlice confirms the empty-but-valid
// boundary: a Payload with zero Data entries decodes to an empty (not
// nil-erroring) slice and preserves the Payload-level VIN/CreatedAt
// for any caller that needs them out-of-band (none currently, but the
// invariant is cheap to lock in).
func TestDecode_EmptyPayloadIsEmptySlice(t *testing.T) {
	p := &ftproto.Payload{
		Vin:       "5YJ3E1EA0KF000123",
		CreatedAt: timestamppb.Now(),
	}
	bytes, err := proto.Marshal(p)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}
	atoms, err := Decode(bytes)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if len(atoms) != 0 {
		t.Errorf("empty Payload Decode = %d atoms, want 0", len(atoms))
	}
}

// TestDecode_PerDatumFailuresDoNotAbortPayload asserts that a JSON parse
// failure on one compound Datum does NOT prevent the rest of the Payload
// from being decoded. This is the second half of the ADR-004 contract:
// only outer Unmarshal failures trigger redelivery; per-field failures
// drop the offending row and continue.
func TestDecode_PerDatumFailuresDoNotAbortPayload(t *testing.T) {
	p := &ftproto.Payload{
		Vin:       "5YJ3E1EA0KF000999",
		CreatedAt: timestamppb.New(time.Date(2025, time.April, 10, 9, 15, 30, 0, time.UTC)),
		Data: []*ftproto.Datum{
			{
				// good scalar
				Key:   ftproto.Field_VehicleSpeed,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 12.0}},
			},
			{
				// malformed JSON DoorState — must be dropped, not aborted
				Key:   ftproto.Field_DoorState,
				Value: &ftproto.Value{Value: &ftproto.Value_StringValue{StringValue: "{not json"}},
			},
			{
				// good follow-up scalar that MUST still appear
				Key:   ftproto.Field_BatteryLevel,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 78.0}},
			},
		},
	}
	bytes, err := proto.Marshal(p)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}
	atoms, err := Decode(bytes)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	gotNames := fieldNames(atoms)
	wantNames := []string{"BatteryLevel", "VehicleSpeed"}
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("malformed-JSON Datum should drop without aborting; got fields %v, want %v",
			gotNames, wantNames)
	}
}

// TestFlattenIfCompound_PassThroughForScalar confirms the no-op path for
// non-compound values: the codec returns a single Atomic carrying the
// value through unchanged. This is the bulk of telemetry signals
// (VehicleSpeed, BatteryLevel, etc.) and a regression here would mean
// every scalar in production starts losing its EmittedAt or VehicleID.
func TestFlattenIfCompound_PassThroughForScalar(t *testing.T) {
	got, err := flattenIfCompound("VehicleSpeed", float32(65.5), fixedEmittedAt, fixedVIN)
	if err != nil {
		t.Fatalf("flattenIfCompound err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("flattenIfCompound passthrough = %d atoms, want 1", len(got))
	}
	a := got[0]
	if a.Field != "VehicleSpeed" {
		t.Errorf("Field = %q, want VehicleSpeed", a.Field)
	}
	if v, ok := a.Value.(float32); !ok || v != 65.5 {
		t.Errorf("Value = %v (%T), want float32(65.5)", a.Value, a.Value)
	}
	if !a.EmittedAt.Equal(fixedEmittedAt) || a.VehicleID != fixedVIN {
		t.Errorf("metadata not propagated: EmittedAt=%v VehicleID=%q", a.EmittedAt, a.VehicleID)
	}
}

// TestFlattenIfCompound_StringNonCompoundFieldIsPassThrough confirms
// that a string-typed value whose field name is NOT one of the three
// JSON-shaped compounds (DoorState, ScheduledChargingStartTime,
// ScheduledDepartureTime) flows through as a plain string atomic — the
// codec must not accidentally interpret arbitrary string fields as JSON.
func TestFlattenIfCompound_StringNonCompoundFieldIsPassThrough(t *testing.T) {
	got, err := flattenIfCompound("VehicleName", "Roadster", fixedEmittedAt, fixedVIN)
	if err != nil {
		t.Fatalf("flattenIfCompound err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d atoms, want 1", len(got))
	}
	if got[0].Value.(string) != "Roadster" {
		t.Errorf("string passthrough lost value: got %v", got[0].Value)
	}
}
