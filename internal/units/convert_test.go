package units

import (
	"math"
	"testing"
)

const epsilon = 0.001

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < epsilon
}

func TestNormalizeDistance(t *testing.T) {
	tests := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"miles passthrough", 100, DistMiles, 100},
		{"unknown passthrough", 50, DistUnknown, 50},
		{"unrecognised treated as miles", 75, "Furlongs", 75},
		{"kilometers to miles", 100, DistKilometers, 62.1371},
		{"zero kilometers", 0, DistKilometers, 0},
		{"negative kilometers", -10, DistKilometers, -6.21371},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeDistance(tt.value, tt.fromUnit)
			if !almostEqual(got, tt.want) {
				t.Fatalf("NormalizeDistance(%v, %q) = %v, want %v", tt.value, tt.fromUnit, got, tt.want)
			}
		})
	}
}

func TestNormalizeSpeed(t *testing.T) {
	// Speed shares the distance ratio (km/h → mph).
	if got := NormalizeSpeed(100, DistKilometers); !almostEqual(got, 62.1371) {
		t.Fatalf("100 km/h → %v mph, want ~62.1371", got)
	}
	if got := NormalizeSpeed(50, DistMiles); !almostEqual(got, 50) {
		t.Fatalf("50 mph passthrough → %v, want 50", got)
	}
}

func TestNormalizeTemp(t *testing.T) {
	tests := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"celsius passthrough", 20, TempCelsius, 20},
		{"unknown passthrough", -5, TempUnknown, -5},
		{"32F → 0C", 32, TempFahrenheit, 0},
		{"212F → 100C", 212, TempFahrenheit, 100},
		{"-40F → -40C (parity point)", -40, TempFahrenheit, -40},
		{"68F → 20C (room temp)", 68, TempFahrenheit, 20},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeTemp(tt.value, tt.fromUnit)
			if !almostEqual(got, tt.want) {
				t.Fatalf("NormalizeTemp(%v, %q) = %v, want %v", tt.value, tt.fromUnit, got, tt.want)
			}
		})
	}
}

func TestNormalizePressure(t *testing.T) {
	tests := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"psi passthrough", 32, PressPSI, 32},
		{"unknown passthrough", 30, PressUnknown, 30},
		{"2.5 bar → ~36.26 PSI (typical tire)", 2.5, PressBar, 36.2595},
		{"1 bar → ~14.5 PSI", 1, PressBar, 14.5038},
		{"zero bar", 0, PressBar, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizePressure(tt.value, tt.fromUnit)
			if !almostEqual(got, tt.want) {
				t.Fatalf("NormalizePressure(%v, %q) = %v, want %v", tt.value, tt.fromUnit, got, tt.want)
			}
		})
	}
}

func TestGetUnitFromSnapshot(t *testing.T) {
	t.Run("present string", func(t *testing.T) {
		snap := map[string]interface{}{"SettingDistanceUnit": "Kilometers"}
		if got := GetUnitFromSnapshot(snap, "SettingDistanceUnit"); got != "Kilometers" {
			t.Fatalf("got %q, want Kilometers", got)
		}
	})

	t.Run("missing key returns empty", func(t *testing.T) {
		if got := GetUnitFromSnapshot(map[string]interface{}{}, "SettingDistanceUnit"); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})

	t.Run("non-string value returns empty", func(t *testing.T) {
		snap := map[string]interface{}{"SettingDistanceUnit": 42}
		if got := GetUnitFromSnapshot(snap, "SettingDistanceUnit"); got != "" {
			t.Fatalf("got %q, want empty for non-string", got)
		}
	})

	t.Run("nil snapshot is safe", func(t *testing.T) {
		// Reading from a nil map is a legal Go no-op; must not panic.
		if got := GetUnitFromSnapshot(nil, "SettingDistanceUnit"); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})
}

// Round-trip property: f(c) → c → c stays stable through the
// Fahrenheit ↔ Celsius normalisation.
func TestNormalizeTemp_FahrenheitRoundTrip(t *testing.T) {
	for _, c := range []float64{-40, 0, 20, 37, 100} {
		f := c*9/5 + 32
		got := NormalizeTemp(f, TempFahrenheit)
		if !almostEqual(got, c) {
			t.Fatalf("round-trip %vC → %vF → %vC, want %vC", c, f, got, c)
		}
	}
}
