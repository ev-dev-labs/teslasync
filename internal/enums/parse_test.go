package enums

import "testing"

// The dropped Parse* tests (TestParseGear, TestParseHvacAutoMode,
// TestParseChargePort, TestParseChargePortLatch, TestParseChargeState,
// TestParseDetailedChargeState, TestParseCabinOverheatMode,
// TestParseClimateKeeperMode, TestParseDefrostMode, TestParseSentryMode,
// TestParseBMSState, TestParseForwardCollisionWarning,
// TestParseLaneDepartureAvoidance, TestParseSpeedLimitWarning,
// TestParseCruiseFollowDistance, TestParseWindowState,
// TestParseTonneauPosition, TestParseTonneauTentMode) covered the
// per-enum prefix-strippers that the codec absorbed at the SINGLE
// conversion point — see protomodel.DecodeValue. Their parsers were
// deleted; the canonical-string contract is verified end-to-end by
// internal/tesla/protomodel.TestDecodeValue_Variants and
// internal/tesla_pipeline.TestE2EPipeline_AllDestinationsAndObserverFire.

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

func TestIsChargeEnded(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"DetailedChargeStateComplete", false},
		{"Stopped", false},
		{"Disconnected", true},
		{"DetailedChargeStateDisconnected", true},
		{"NoPower", false},
		{"DetailedChargeStateNoPower", false},
		{"Charging", false},
		{"Starting", false},
		{"Unknown", false},
		{"NotComplete", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := IsChargeEnded(tt.input); got != tt.expected {
				t.Errorf("IsChargeEnded(%q) = %v, want %v", tt.input, got, tt.expected)
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
