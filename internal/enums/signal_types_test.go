package enums

import (
	"testing"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"
)

func TestSignalRegistryCompleteness(t *testing.T) {
	// Every signal in SignalRegistry should have a valid proto field ID (not Unknown).
	for name, info := range SignalRegistry {
		if info.FieldID == ftproto.Field_Unknown {
			t.Errorf("SignalRegistry[%q] has Field_Unknown — check proto mapping", name)
		}
	}
}

func TestSignalRegistryCount(t *testing.T) {
	// We should have at least 200 signals mapped (proto has 259 fields minus
	// deprecated, experimental, and semi-truck-only).
	if len(SignalRegistry) < 200 {
		t.Errorf("SignalRegistry has %d entries, expected at least 200", len(SignalRegistry))
	}
}

func TestIsCompoundSignal(t *testing.T) {
	tests := []struct {
		name     string
		expected bool
	}{
		{"Location", true},
		{"DestinationLocation", true},
		{"OriginLocation", true},
		{"DoorState", true},
		{"RouteLine", true},
		{"TpmsHardWarnings", true},
		{"VehicleSpeed", false},
		{"BatteryLevel", false},
		{"SentryMode", false},
		{"Locked", false},
		{"UnknownSignal", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsCompoundSignal(tt.name)
			if got != tt.expected {
				t.Errorf("IsCompoundSignal(%q) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestIsEnumSignal(t *testing.T) {
	tests := []struct {
		name     string
		expected bool
	}{
		{"SentryMode", true},
		{"DetailedChargeState", true},
		{"Gear", true},
		{"HvacPower", true},
		{"CenterDisplay", true},
		{"VehicleSpeed", false},
		{"Locked", false},
		{"Location", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsEnumSignal(tt.name)
			if got != tt.expected {
				t.Errorf("IsEnumSignal(%q) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestProtoFieldID(t *testing.T) {
	tests := []struct {
		name     string
		expected ftproto.Field
	}{
		{"Location", ftproto.Field_Location},
		{"VehicleSpeed", ftproto.Field_VehicleSpeed},
		{"BatteryLevel", ftproto.Field_BatteryLevel},
		{"DoorState", ftproto.Field_DoorState},
		{"UnknownSignal", ftproto.Field_Unknown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProtoFieldID(tt.name)
			if got != tt.expected {
				t.Errorf("ProtoFieldID(%q) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestGetSignalType(t *testing.T) {
	tests := []struct {
		name     string
		expected SignalType
	}{
		{"VehicleSpeed", TypeFloat},
		{"Locked", TypeBool},
		{"VehicleName", TypeString},
		{"SentryMode", TypeEnum},
		{"Location", TypeLocation},
		{"DoorState", TypeDoors},
		{"UnknownSignal", TypeString}, // fallback
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetSignalType(tt.name)
			if got != tt.expected {
				t.Errorf("GetSignalType(%q) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}
