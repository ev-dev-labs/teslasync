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
		{"normalized Armed", "Armed", true},
		{"normalized Off", "Off", false},
		{"normalized Idle", "Idle", true},
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

func TestParseForwardCollisionWarning(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ForwardCollisionSensitivityOff", "Off"},
		{"ForwardCollisionSensitivityLate", "Late"},
		{"ForwardCollisionSensitivityAverage", "Average"},
		{"ForwardCollisionSensitivityEarly", "Early"},
		{"Off", "Off"},
		{"Early", "Early"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseForwardCollisionWarning(tt.input)
			if got != tt.expected {
				t.Errorf("ParseForwardCollisionWarning(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseLaneDepartureAvoidance(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"LaneAssistLevelOff", "Off"},
		{"LaneAssistLevelWarning", "Warning"},
		{"LaneAssistLevelAssist", "Assist"},
		{"Off", "Off"},
		{"Warning", "Warning"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseLaneDepartureAvoidance(tt.input)
			if got != tt.expected {
				t.Errorf("ParseLaneDepartureAvoidance(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseSpeedLimitWarning(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"SpeedAssistLevelNone", "Off"},
		{"SpeedAssistLevelDisplay", "Display"},
		{"SpeedAssistLevelChime", "Chime"},
		{"Off", "Off"},
		{"Display", "Display"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseSpeedLimitWarning(tt.input)
			if got != tt.expected {
				t.Errorf("ParseSpeedLimitWarning(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseBMSState(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"BMSStateStandby", "Standby"},
		{"BMSStateDrive", "Drive"},
		{"BMSStateSupport", "Support"},
		{"BMSStateCharge", "Charge"},
		{"BMSStateFault", "Fault"},
		{"Standby", "Standby"},
		{"Drive", "Drive"},
		{"Charge", "Charge"},
		{"Fault", "Fault"},
		{"BMSStateNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseBMSState(tt.input)
			if got != tt.expected {
				t.Errorf("ParseBMSState(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseCruiseFollowDistance(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"FollowDistance1", "1"},
		{"FollowDistance7", "7"},
		{"FollowDistance3", "3"},
		{"1", "1"},
		{"7", "7"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseCruiseFollowDistance(tt.input)
			if got != tt.expected {
				t.Errorf("ParseCruiseFollowDistance(%q) = %q, want %q", tt.input, got, tt.expected)
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

func TestParseChargePort(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ChargePortOpen", "Open"},
		{"ChargePortClosed", "Closed"},
		{"Open", "Open"},
		{"Closed", "Closed"},
		{"ChargePortNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseChargePort(tt.input)
			if got != tt.expected {
				t.Errorf("ParseChargePort(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseChargePortLatch(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ChargePortLatchEngaged", "Engaged"},
		{"ChargePortLatchDisengaged", "Disengaged"},
		{"Engaged", "Engaged"},
		{"Disengaged", "Disengaged"},
		{"ChargePortLatchNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseChargePortLatch(tt.input)
			if got != tt.expected {
				t.Errorf("ParseChargePortLatch(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseChargeState(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ChargeStateCharging", "Charging"},
		{"ChargeStateComplete", "Complete"},
		{"ChargeStateDisconnected", "Disconnected"},
		{"ChargeStateNoPower", "NoPower"},
		{"ChargeStateStarting", "Starting"},
		{"ChargeStateStopped", "Stopped"},
		{"ChargeStateEnable", "Charging"},
		{"Charging", "Charging"},
		{"Complete", "Complete"},
		{"Disconnected", "Disconnected"},
		{"NoPower", "NoPower"},
		{"Starting", "Starting"},
		{"Stopped", "Stopped"},
		{"Enable", "Charging"},
		{"ChargeStateNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseChargeState(tt.input)
			if got != tt.expected {
				t.Errorf("ParseChargeState(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseSentryMode(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"SentryModeStateOff", "Off"},
		{"SentryModeStateIdle", "Idle"},
		{"SentryModeStateArmed", "Armed"},
		{"SentryModeStateAware", "Aware"},
		{"SentryModeStatePanic", "Panic"},
		{"SentryModeStateQuiet", "Quiet"},
		{"Off", "Off"},
		{"Armed", "Armed"},
		{"SentryModeStateNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseSentryMode(tt.input)
			if got != tt.expected {
				t.Errorf("ParseSentryMode(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestParseDetailedChargeState(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"DetailedChargeStateCharging", "Charging"},
		{"DetailedChargeStateComplete", "Complete"},
		{"DetailedChargeStateDisconnected", "Disconnected"},
		{"DetailedChargeStateNoPower", "NoPower"},
		{"DetailedChargeStateStarting", "Starting"},
		{"DetailedChargeStateStopped", "Stopped"},
		{"DetailedChargeStateError", "Error"},
		{"Charging", "Charging"},
		{"Complete", "Complete"},
		{"Disconnected", "Disconnected"},
		{"Error", "Error"},
		{"DetailedChargeStateNewValue", "NewValue"},
		{"SomeUnknown", "SomeUnknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseDetailedChargeState(tt.input)
			if got != tt.expected {
				t.Errorf("ParseDetailedChargeState(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
