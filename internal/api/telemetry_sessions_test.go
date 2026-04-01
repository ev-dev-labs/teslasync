package api

import (
	"testing"
)

func TestSignalFloat(t *testing.T) {
	tests := []struct {
		name     string
		signals  map[string]interface{}
		keys     []string
		wantVal  float64
		wantOk   bool
	}{
		{"float value", map[string]interface{}{"Speed": 65.5}, []string{"Speed"}, 65.5, true},
		{"int value", map[string]interface{}{"Speed": 65}, []string{"Speed"}, 65, true},
		{"missing key", map[string]interface{}{}, []string{"Speed"}, 0, false},
		{"fallback key", map[string]interface{}{"Soc": 80.0}, []string{"BatteryLevel", "Soc"}, 80.0, true},
		{"string number", map[string]interface{}{"Speed": "65.5"}, []string{"Speed"}, 65.5, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			val, ok := signalFloat(tt.signals, tt.keys...)
			if ok != tt.wantOk {
				t.Errorf("signalFloat() ok = %v, want %v", ok, tt.wantOk)
			}
			if ok && val != tt.wantVal {
				t.Errorf("signalFloat() val = %v, want %v", val, tt.wantVal)
			}
		})
	}
}

func TestSignalInt(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		keys    []string
		wantVal int
		wantOk  bool
	}{
		{"float to int", map[string]interface{}{"BatteryLevel": 80.0}, []string{"BatteryLevel"}, 80, true},
		{"missing", map[string]interface{}{}, []string{"BatteryLevel"}, 0, false},
		{"fallback", map[string]interface{}{"Soc": 50.0}, []string{"BatteryLevel", "Soc"}, 50, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			val, ok := signalInt(tt.signals, tt.keys...)
			if ok != tt.wantOk {
				t.Errorf("signalInt() ok = %v, want %v", ok, tt.wantOk)
			}
			if ok && val != tt.wantVal {
				t.Errorf("signalInt() val = %v, want %v", val, tt.wantVal)
			}
		})
	}
}

func TestSignalStr(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		keys    []string
		wantVal string
		wantOk  bool
	}{
		{"string value", map[string]interface{}{"ChargeState": "Charging"}, []string{"ChargeState"}, "Charging", true},
		{"empty string", map[string]interface{}{"ChargeState": ""}, []string{"ChargeState"}, "", false},
		{"missing", map[string]interface{}{}, []string{"ChargeState"}, "", false},
		{"fallback", map[string]interface{}{"DetailedChargeState": "Starting"}, []string{"ChargeState", "DetailedChargeState"}, "Starting", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			val, ok := signalStr(tt.signals, tt.keys...)
			if ok != tt.wantOk {
				t.Errorf("signalStr() ok = %v, want %v", ok, tt.wantOk)
			}
			if ok && val != tt.wantVal {
				t.Errorf("signalStr() val = %v, want %v", val, tt.wantVal)
			}
		})
	}
}

func TestToFloatOk(t *testing.T) {
	tests := []struct {
		name    string
		input   interface{}
		wantVal float64
		wantOk  bool
	}{
		{"nil", nil, 0, false},
		{"float64", float64(42.5), 42.5, true},
		{"int", int(42), 42, true},
		{"int64", int64(42), 42, true},
		{"zero float", float64(0), 0, true},
		{"zero int", int(0), 0, true},
		{"string number", "42.5", 42.5, true},
		{"empty string", "", 0, false},
		{"nil string", "<nil>", 0, false},
		{"null string", "null", 0, false},
		{"bool true", true, 1, true},
		{"bool false", false, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			val, ok := toFloatOk(tt.input)
			if ok != tt.wantOk {
				t.Errorf("toFloatOk(%v) ok = %v, want %v", tt.input, ok, tt.wantOk)
			}
			if ok && val != tt.wantVal {
				t.Errorf("toFloatOk(%v) val = %v, want %v", tt.input, val, tt.wantVal)
			}
		})
	}
}

func TestFloatPtr(t *testing.T) {
	v := 42.5
	p := floatPtr(v)
	if p == nil || *p != v {
		t.Errorf("floatPtr(%v) = %v, want %v", v, p, &v)
	}
}

func TestIntPtr(t *testing.T) {
	v := 42
	p := intPtr(v)
	if p == nil || *p != v {
		t.Errorf("intPtr(%v) = %v, want %v", v, p, &v)
	}
}
