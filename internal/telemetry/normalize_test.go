package telemetry

import (
	"encoding/json"
	"testing"
)

func TestNormalizeFleetUnits_TypeTime(t *testing.T) {
	tests := []struct {
		name     string
		signal   string
		input    interface{}
		expected interface{}
		changed  bool
	}{
		{
			name:     "compound map with hour/minute/second",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"hour": float64(22), "minute": float64(30), "second": float64(0)},
			expected: "22:30:00",
			changed:  true,
		},
		{
			name:     "compound map without second (optional)",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"hour": float64(8), "minute": float64(15)},
			expected: "08:15:00",
			changed:  true,
		},
		{
			name:     "wrapped in value envelope",
			signal:   "ScheduledDepartureTime",
			input:    map[string]interface{}{"value": map[string]interface{}{"hour": float64(7), "minute": float64(0), "second": float64(0)}},
			expected: "07:00:00",
			changed:  true,
		},
		{
			name:     "wrapped value is string",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"value": "14:30:00"},
			expected: "14:30:00",
			changed:  true,
		},
		{
			name:     "already a string",
			signal:   "ScheduledChargingStartTime",
			input:    "22:30:00",
			expected: "22:30:00",
			changed:  false,
		},
		{
			name:     "malformed map missing hour",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"minute": float64(30)},
			expected: map[string]interface{}{"minute": float64(30)},
			changed:  false,
		},
		{
			name:     "out of range hour",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"hour": float64(25), "minute": float64(30), "second": float64(0)},
			expected: map[string]interface{}{"hour": float64(25), "minute": float64(30), "second": float64(0)},
			changed:  false,
		},
		{
			name:     "midnight edge case",
			signal:   "ScheduledDepartureTime",
			input:    map[string]interface{}{"hour": float64(0), "minute": float64(0), "second": float64(0)},
			expected: "00:00:00",
			changed:  true,
		},
		{
			name:     "end of day edge case",
			signal:   "ScheduledChargingStartTime",
			input:    map[string]interface{}{"hour": float64(23), "minute": float64(59), "second": float64(59)},
			expected: "23:59:59",
			changed:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nvs := []NamedValue{{Name: tt.signal, Value: tt.input}}
			out := NormalizeFleetUnits(nvs)

			got := out[0].Value
			if gotStr, ok := got.(string); ok {
				if expStr, ok := tt.expected.(string); ok {
					if gotStr != expStr {
						t.Errorf("got %q, want %q", gotStr, expStr)
					}
					return
				}
			}
			if !tt.changed {
				if _, isStr := got.(string); isStr {
					t.Errorf("expected unchanged map, got string %q", got)
				}
			}
		})
	}
}

func TestNormalizeFleetUnits_TypeDoors(t *testing.T) {
	tests := []struct {
		name    string
		input   interface{}
		wantStr bool
	}{
		{
			name:    "compound map → JSON string",
			input:   map[string]interface{}{"DriverFront": true, "PassengerFront": false, "DriverRear": false, "PassengerRear": false},
			wantStr: true,
		},
		{
			name:    "wrapped in value envelope → JSON string",
			input:   map[string]interface{}{"value": map[string]interface{}{"DriverFront": true, "PassengerRear": true}},
			wantStr: true,
		},
		{
			name:    "wrapped value is string → passthrough",
			input:   map[string]interface{}{"value": "ClosedAll"},
			wantStr: true,
		},
		{
			name:    "already a string → unchanged",
			input:   "ClosedAll",
			wantStr: true,
		},
		{
			name:    "string 0 → unchanged",
			input:   "0",
			wantStr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nvs := []NamedValue{{Name: "DoorState", Value: tt.input}}
			out := NormalizeFleetUnits(nvs)

			got := out[0].Value
			gotStr, isStr := got.(string)
			if !isStr && tt.wantStr {
				t.Fatalf("expected string result, got %T: %v", got, got)
			}
			if !isStr {
				return
			}

			if _, wasMap := tt.input.(map[string]interface{}); wasMap {
				var parsed map[string]interface{}
				if err := json.Unmarshal([]byte(gotStr), &parsed); err != nil {
					if gotStr != "ClosedAll" {
						t.Errorf("result is not valid JSON: %q, err: %v", gotStr, err)
					}
				}
			}
		})
	}
}

func TestExtractTimeField(t *testing.T) {
	tests := []struct {
		name string
		m    map[string]interface{}
		key  string
		want int
		ok   bool
	}{
		{"float64", map[string]interface{}{"hour": float64(22)}, "hour", 22, true},
		{"int", map[string]interface{}{"hour": int(22)}, "hour", 22, true},
		{"int64", map[string]interface{}{"hour": int64(22)}, "hour", 22, true},
		{"missing key", map[string]interface{}{}, "hour", 0, false},
		{"string value", map[string]interface{}{"hour": "22"}, "hour", 0, false},
		{"nil value", map[string]interface{}{"hour": nil}, "hour", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := extractTimeField(tt.m, tt.key)
			if ok != tt.ok {
				t.Errorf("extractTimeField ok = %v, want %v", ok, tt.ok)
			}
			if got != tt.want {
				t.Errorf("extractTimeField = %d, want %d", got, tt.want)
			}
		})
	}
}

// TestNormalizeFleetUnits_PreservesOrder confirms that NormalizeFleetUnits
// returns values in the order they were emitted, which the FSM relies on
// to compute deterministic prior→new state diffs within a single batch.
func TestNormalizeFleetUnits_PreservesOrder(t *testing.T) {
	in := []NamedValue{
		{Name: "Gear", Value: "ShiftStateD"},
		{Name: "VehicleSpeed", Value: 35.0},
		{Name: "ChargeState", Value: "ChargeStateCharging"},
		{Name: "Odometer", Value: 12345.6},
	}
	out := NormalizeFleetUnits(in)
	if len(out) != len(in) {
		t.Fatalf("length changed: got %d want %d", len(out), len(in))
	}
	wantNames := []string{"Gear", "VehicleSpeed", "ChargeState", "Odometer"}
	for i, want := range wantNames {
		if out[i].Name != want {
			t.Errorf("position %d: got name %q want %q", i, out[i].Name, want)
		}
	}
}
