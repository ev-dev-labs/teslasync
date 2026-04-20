package api

import (
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
			signals := map[string]interface{}{
				tt.signal: tt.input,
			}
			normalizeFleetUnits(signals)

			got := signals[tt.signal]
			// Compare string results
			if gotStr, ok := got.(string); ok {
				if expStr, ok := tt.expected.(string); ok {
					if gotStr != expStr {
						t.Errorf("got %q, want %q", gotStr, expStr)
					}
					return
				}
			}
			// If not changed, the value should be the same type as input
			if !tt.changed {
				// Just verify the value wasn't changed to a string
				if _, isStr := got.(string); isStr {
					t.Errorf("expected unchanged map, got string %q", got)
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
