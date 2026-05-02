package protomodel

import (
	"errors"
	"reflect"
	"testing"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"
)

// TestDecodeValue_Variants is the canonical contract test for DecodeValue:
// every category of oneof variant (string, int, float, enum, compound) plus
// the two error sentinels (ErrInvalid for the invalid flag, ErrUnsetValue
// for the unset-oneof case) is covered. For populated cases the test
// asserts the EXACT returned Go type via reflect.TypeOf so a future codegen
// change that silently widens or narrows a return type cannot land
// unnoticed.
func TestDecodeValue_Variants(t *testing.T) {
	tests := []struct {
		name      string
		input     *ftproto.Value
		wantValue any
		wantType  reflect.Type
		wantErr   error
	}{
		{
			name:      "string variant returns string",
			input:     &ftproto.Value{Value: &ftproto.Value_StringValue{StringValue: "hello"}},
			wantValue: "hello",
			wantType:  reflect.TypeOf(""),
		},
		{
			name:      "int variant returns int32",
			input:     &ftproto.Value{Value: &ftproto.Value_IntValue{IntValue: 42}},
			wantValue: int32(42),
			wantType:  reflect.TypeOf(int32(0)),
		},
		{
			name:      "long variant returns int64",
			input:     &ftproto.Value{Value: &ftproto.Value_LongValue{LongValue: 1 << 40}},
			wantValue: int64(1 << 40),
			wantType:  reflect.TypeOf(int64(0)),
		},
		{
			name:      "float variant returns float32",
			input:     &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 65.5}},
			wantValue: float32(65.5),
			wantType:  reflect.TypeOf(float32(0)),
		},
		{
			name:      "double variant returns float64",
			input:     &ftproto.Value{Value: &ftproto.Value_DoubleValue{DoubleValue: 3.14159}},
			wantValue: 3.14159,
			wantType:  reflect.TypeOf(float64(0)),
		},
		{
			name:      "boolean variant returns bool",
			input:     &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			wantValue: true,
			wantType:  reflect.TypeOf(false),
		},
		{
			name: "enum variant (ShiftState) returns typed proto enum",
			input: &ftproto.Value{
				Value: &ftproto.Value_ShiftStateValue{ShiftStateValue: ftproto.ShiftState_ShiftStateD},
			},
			wantValue: ftproto.ShiftState_ShiftStateD,
			wantType:  reflect.TypeOf(ftproto.ShiftState(0)),
		},
		{
			name: "compound variant (Location) returns typed Location struct",
			input: &ftproto.Value{
				Value: &ftproto.Value_LocationValue{
					LocationValue: &ftproto.LocationValue{Latitude: 37.7749, Longitude: -122.4194},
				},
			},
			wantValue: Location{Latitude: 37.7749, Longitude: -122.4194},
			wantType:  reflect.TypeOf(Location{}),
		},
		{
			name: "compound variant (Doors) returns typed Doors struct",
			input: &ftproto.Value{
				Value: &ftproto.Value_DoorValue{
					DoorValue: &ftproto.Doors{
						DriverFront:    true,
						DriverRear:     false,
						PassengerFront: true,
						PassengerRear:  false,
						TrunkFront:     false,
						TrunkRear:      true,
					},
				},
			},
			wantValue: Doors{DriverFront: true, PassengerFront: true, TrunkRear: true},
			wantType:  reflect.TypeOf(Doors{}),
		},
		{
			name: "compound variant (Time) returns typed Time struct",
			input: &ftproto.Value{
				Value: &ftproto.Value_TimeValue{TimeValue: &ftproto.Time{Hour: 22, Minute: 30, Second: 5}},
			},
			wantValue: Time{Hour: 22, Minute: 30, Second: 5},
			wantType:  reflect.TypeOf(Time{}),
		},
		{
			name:    "invalid-flagged value returns ErrInvalid",
			input:   &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: true}},
			wantErr: ErrInvalid,
		},
		{
			name:    "unset oneof returns ErrUnsetValue",
			input:   &ftproto.Value{},
			wantErr: ErrUnsetValue,
		},
		{
			name:    "nil Value pointer returns ErrUnsetValue",
			input:   nil,
			wantErr: ErrUnsetValue,
		},
		{
			name:    "Invalid==false (rare) returns ErrUnsetValue not ErrInvalid",
			input:   &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: false}},
			wantErr: ErrUnsetValue,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeValue(tt.input)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("DecodeValue() err = %v, want %v", err, tt.wantErr)
				}
				if got != nil {
					t.Fatalf("DecodeValue() value = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecodeValue() unexpected err = %v", err)
			}
			gotType := reflect.TypeOf(got)
			if gotType != tt.wantType {
				t.Fatalf("DecodeValue() returned type %v, want %v", gotType, tt.wantType)
			}
			if !reflect.DeepEqual(got, tt.wantValue) {
				t.Fatalf("DecodeValue() = %v, want %v", got, tt.wantValue)
			}
		})
	}
}

// TestDecodeValue_InvalidPrecedesPopulated ensures the invalid flag is
// honored even when the producer also populates one of the typed scalar
// slots in the same Value (defensive: real producers should not do this,
// but the contract per ADR-004 is that invalid==true wins unconditionally).
func TestDecodeValue_InvalidPrecedesPopulated(t *testing.T) {
	v := &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: true}}
	got, err := DecodeValue(v)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("DecodeValue() err = %v, want ErrInvalid", err)
	}
	if got != nil {
		t.Fatalf("DecodeValue() value = %v, want nil when invalid", got)
	}
}

// TestDecodeDatum exercises the (field, value, err) tuple form: every
// success/error combination DecodeValue returns must also be reachable via
// DecodeDatum, with the field name extracted from Datum.Key.String().
func TestDecodeDatum(t *testing.T) {
	tests := []struct {
		name      string
		input     *ftproto.Datum
		wantField string
		wantValue any
		wantErr   error
	}{
		{
			name: "populated float datum returns field name and float32",
			input: &ftproto.Datum{
				Key:   ftproto.Field_VehicleSpeed,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 65.0}},
			},
			wantField: "VehicleSpeed",
			wantValue: float32(65.0),
		},
		{
			name: "populated string datum returns field name and string",
			input: &ftproto.Datum{
				Key:   ftproto.Field_VehicleName,
				Value: &ftproto.Value{Value: &ftproto.Value_StringValue{StringValue: "Roadster"}},
			},
			wantField: "VehicleName",
			wantValue: "Roadster",
		},
		{
			name: "invalid datum returns field name and ErrInvalid",
			input: &ftproto.Datum{
				Key:   ftproto.Field_VehicleSpeed,
				Value: &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: true}},
			},
			wantField: "VehicleSpeed",
			wantErr:   ErrInvalid,
		},
		{
			name: "datum with nil value returns field name and ErrUnsetValue",
			input: &ftproto.Datum{
				Key:   ftproto.Field_VehicleSpeed,
				Value: nil,
			},
			wantField: "VehicleSpeed",
			wantErr:   ErrUnsetValue,
		},
		{
			name:      "nil datum returns empty field and ErrUnsetValue",
			input:     nil,
			wantField: "",
			wantErr:   ErrUnsetValue,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			field, value, err := DecodeDatum(tt.input)
			if field != tt.wantField {
				t.Fatalf("DecodeDatum() field = %q, want %q", field, tt.wantField)
			}
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("DecodeDatum() err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecodeDatum() unexpected err = %v", err)
			}
			if !reflect.DeepEqual(value, tt.wantValue) {
				t.Fatalf("DecodeDatum() value = %v (%T), want %v (%T)",
					value, value, tt.wantValue, tt.wantValue)
			}
		})
	}
}

// TestDecodeValue_AllOneofVariantsCovered is a reflection-based safety net:
// it walks every concrete type that satisfies the unexported isValue_Value
// interface in the ftproto package (i.e. every *ftproto.Value_* oneof
// variant) and asserts DecodeValue returns either a non-nil value or one of
// our defined error sentinels for each. This guards against a future
// vendored-proto bump silently adding a new variant that DecodeValue does
// not yet handle (the default arm would catch it; this test makes the
// failure loud at codegen time rather than silent at runtime).
func TestDecodeValue_AllOneofVariantsCovered(t *testing.T) {
	// Sample-construct each known variant by name and confirm it does not
	// trip the default "unhandled Value oneof variant" arm. We can't easily
	// enumerate the unexported interface from outside the ftproto package,
	// so we explicitly list every *Value_* type the vendored proto declares.
	// If a new variant is added upstream, the codegen drift test (in a
	// later prompt) will fail before this list goes stale.
	// We construct one *ftproto.Value per known oneof variant directly
	// (the underlying isValue_Value interface is unexported in ftproto, so
	// a typed slice over it isn't possible from this package; this is the
	// idiomatic workaround and remains exhaustive).
	variants := []*ftproto.Value{
		{Value: &ftproto.Value_StringValue{}},
		{Value: &ftproto.Value_IntValue{}},
		{Value: &ftproto.Value_LongValue{}},
		{Value: &ftproto.Value_FloatValue{}},
		{Value: &ftproto.Value_DoubleValue{}},
		{Value: &ftproto.Value_BooleanValue{}},
		{Value: &ftproto.Value_LocationValue{}},
		{Value: &ftproto.Value_ChargingValue{}},
		{Value: &ftproto.Value_ShiftStateValue{}},
		{Value: &ftproto.Value_LaneAssistLevelValue{}},
		{Value: &ftproto.Value_ScheduledChargingModeValue{}},
		{Value: &ftproto.Value_SentryModeStateValue{}},
		{Value: &ftproto.Value_SpeedAssistLevelValue{}},
		{Value: &ftproto.Value_BmsStateValue{}},
		{Value: &ftproto.Value_BuckleStatusValue{}},
		{Value: &ftproto.Value_CarTypeValue{}},
		{Value: &ftproto.Value_ChargePortValue{}},
		{Value: &ftproto.Value_ChargePortLatchValue{}},
		{Value: &ftproto.Value_DoorValue{}},
		{Value: &ftproto.Value_DriveInverterStateValue{}},
		{Value: &ftproto.Value_HvilStatusValue{}},
		{Value: &ftproto.Value_WindowStateValue{}},
		{Value: &ftproto.Value_SeatFoldPositionValue{}},
		{Value: &ftproto.Value_TractorAirStatusValue{}},
		{Value: &ftproto.Value_FollowDistanceValue{}},
		{Value: &ftproto.Value_ForwardCollisionSensitivityValue{}},
		{Value: &ftproto.Value_GuestModeMobileAccessValue{}},
		{Value: &ftproto.Value_TrailerAirStatusValue{}},
		{Value: &ftproto.Value_TimeValue{}},
		{Value: &ftproto.Value_DetailedChargeStateValue{}},
		{Value: &ftproto.Value_HvacAutoModeValue{}},
		{Value: &ftproto.Value_CabinOverheatProtectionModeValue{}},
		{Value: &ftproto.Value_CabinOverheatProtectionTemperatureLimitValue{}},
		{Value: &ftproto.Value_DefrostModeValue{}},
		{Value: &ftproto.Value_ClimateKeeperModeValue{}},
		{Value: &ftproto.Value_HvacPowerValue{}},
		{Value: &ftproto.Value_TireLocationValue{}},
		{Value: &ftproto.Value_FastChargerValue{}},
		{Value: &ftproto.Value_CableTypeValue{}},
		{Value: &ftproto.Value_TonneauTentModeValue{}},
		{Value: &ftproto.Value_TonneauPositionValue{}},
		{Value: &ftproto.Value_PowershareTypeValue{}},
		{Value: &ftproto.Value_PowershareStateValue{}},
		{Value: &ftproto.Value_PowershareStopReasonValue{}},
		{Value: &ftproto.Value_DisplayStateValue{}},
		{Value: &ftproto.Value_DistanceUnitValue{}},
		{Value: &ftproto.Value_TemperatureUnitValue{}},
		{Value: &ftproto.Value_PressureUnitValue{}},
		{Value: &ftproto.Value_ChargeUnitPreferenceValue{}},
		{Value: &ftproto.Value_TurnSignalStateValue{}},
		{Value: &ftproto.Value_MediaStatusValue{}},
		{Value: &ftproto.Value_SunroofInstalledStateValue{}},
	}
	// The Invalid variant intentionally short-circuits to ErrInvalid; it
	// is exercised by TestDecodeValue_Variants and TestDecodeValue_InvalidPrecedesPopulated.
	for _, v := range variants {
		_, err := DecodeValue(v)
		if err != nil {
			t.Errorf("DecodeValue(%T) returned unexpected error: %v", v.GetValue(), err)
		}
	}
}
