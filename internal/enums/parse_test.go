package enums

import "testing"

func TestParseGear(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ShiftStateD", GearDrive},
		{"ShiftStateR", GearReverse},
		{"ShiftStateP", GearPark},
		{"ShiftStateN", GearNeutral},
		{"ShiftStateDrive", GearDrive},
		{"ShiftStateReverse", GearReverse},
		{"ShiftStatePark", GearPark},
		{"ShiftStateNeutral", GearNeutral},
		{"D", GearDrive},
		{"R", GearReverse},
		{"P", GearPark},
		{"N", GearNeutral},
		{"", ""},
		{"ShiftStateInvalid", ""},
		{"Unknown", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseGear(tt.input)
			if got != tt.expected {
				t.Errorf("ParseGear(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsCharging(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"DetailedChargeStateCharging", true},
		{"DetailedChargeStateStarting", true},
		{"Charging", true},
		{"Starting", true},
		{"Enable", true},
		{"DetailedChargeStateComplete", false},
		{"Disconnected", false},
		{"Stopped", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := IsCharging(tt.input)
			if got != tt.expected {
				t.Errorf("IsCharging(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsChargeComplete(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"DetailedChargeStateComplete", true},
		{"Complete", true},
		{"Charging", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := IsChargeComplete(tt.input)
			if got != tt.expected {
				t.Errorf("IsChargeComplete(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseEnumBool(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected bool
	}{
		{"bool true", true, true},
		{"bool false", false, false},
		{"string On", "SentryModeStateArmed", true},
		{"string Off", "HvacPowerStateOff", false},
		{"string false", "false", false},
		{"string empty", "", false},
		{"string 0", "0", false},
		{"float non-zero", float64(42), true},
		{"float zero", float64(0), false},
		{"int non-zero", 1, true},
		{"int zero", 0, false},
		{"nil", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseEnumBool(tt.input)
			if got != tt.expected {
				t.Errorf("ParseEnumBool(%v) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseHvacPower(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"HvacPowerStateOn", true},
		{"HvacPowerStatePrecondition", true},
		{"HvacPowerStateOff", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseHvacPower(tt.input)
			if got != tt.expected {
				t.Errorf("ParseHvacPower(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseWindowState(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"WindowStateClosed", "Closed"},
		{"WindowStatePartiallyOpen", "Partial"},
		{"WindowStateOpened", "Open"},
		{"Closed", "Closed"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseWindowState(tt.input)
			if got != tt.expected {
				t.Errorf("ParseWindowState(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
