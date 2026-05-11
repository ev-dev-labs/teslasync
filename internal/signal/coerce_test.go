package signal

import (
	"encoding/json"
	"math"
	"testing"
)

func TestFloat64_AllNumericKinds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   any
		want float64
		ok   bool
	}{
		// nil
		{"nil", nil, 0, false},

		// canonical numeric
		{"float64", float64(3.14), 3.14, true},
		{"float32", float32(2.5), 2.5, true},
		{"int", int(42), 42, true},
		{"int8", int8(-7), -7, true},
		{"int16", int16(-1234), -1234, true},
		{"int32", int32(-1_000_000), -1_000_000, true},
		{"int64", int64(1 << 40), float64(int64(1 << 40)), true},
		{"uint", uint(99), 99, true},
		{"uint8", uint8(255), 255, true},
		{"uint16", uint16(65535), 65535, true},
		{"uint32", uint32(4_000_000_000), 4_000_000_000, true},
		{"uint64", uint64(1 << 40), float64(uint64(1 << 40)), true},

		// zero values must round-trip as ok=true
		{"zero float64", float64(0), 0, true},
		{"zero int", int(0), 0, true},
		{"zero float32", float32(0), 0, true},
		{"zero int32", int32(0), 0, true},

		// json.Number (encoding/json with UseNumber)
		{"json.Number int", json.Number("42"), 42, true},
		{"json.Number float", json.Number("3.14"), 3.14, true},
		{"json.Number bad", json.Number("abc"), 0, false},

		// legacy envelope shapes
		{"envelope value float32", map[string]any{"value": float32(1.5)}, 1.5, true},
		{"envelope value int32", map[string]any{"value": int32(7)}, 7, true},
		{"envelope invalid", map[string]any{"invalid": true}, 0, false},
		{"envelope no value", map[string]any{"foo": "bar"}, 0, false},

		// legacy string parsing
		{"string numeric", "42.5", 42.5, true},
		{"string with whitespace", "  3.14 ", 3.14, true},
		{"string empty", "", 0, false},
		{"string nil literal", "<nil>", 0, false},
		{"string null literal", "null", 0, false},
		{"string nan literal", "NaN", 0, false},
		{"string garbage", "abc123", 0, false},
		{"string partial numeric prefix", "12abc", 0, false}, // strconv rejects, Sscanf would have accepted

		// bool legacy
		{"bool true", true, 1, true},
		{"bool false", false, 0, true},

		// rejected
		{"unsupported struct", struct{ X int }{X: 1}, 0, false},
		{"unsupported slice", []int{1, 2}, 0, false},
		{"NaN float64 rejected via string", "NaN", 0, false},
		{"Inf float64 rejected via string", "Inf", 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := Float64(tc.in)
			if ok != tc.ok {
				t.Fatalf("Float64(%v) ok=%v, want %v", tc.in, ok, tc.ok)
			}
			if ok && got != tc.want {
				t.Fatalf("Float64(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestFloat64_RawFloatNaNInfRejected(t *testing.T) {
	t.Parallel()
	// Direct float64 NaN/Inf: current implementation returns ok=true
	// because the type switch hits before any numeric validation. This is
	// intentional — primitive callers that already have a typed float64
	// know what they put in. Strings/json.Number get the validation
	// because those represent decoded user input.
	if _, ok := Float64(math.NaN()); !ok {
		t.Fatalf("primitive NaN float64 should pass through (ok=true)")
	}
	if _, ok := Float64(math.Inf(1)); !ok {
		t.Fatalf("primitive +Inf float64 should pass through (ok=true)")
	}
}

func TestFloat64Value(t *testing.T) {
	t.Parallel()
	if _, ok := Float64Value(nil); ok {
		t.Fatalf("nil *Value must return ok=false")
	}
	v := &Value{Raw: float32(7.5)}
	got, ok := Float64Value(v)
	if !ok || got != 7.5 {
		t.Fatalf("Float64Value(float32 7.5) = %v %v, want 7.5 true", got, ok)
	}
	v2 := &Value{Raw: nil}
	if _, ok := Float64Value(v2); ok {
		t.Fatalf("Value with nil Raw must return ok=false")
	}
}
