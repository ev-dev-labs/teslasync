package units

import (
	"math"
	"testing"
)

// eps bounds float comparisons. The conversion constants in this package
// (1.60934 km/mi, 14.5038 psi/bar, the 5/9 °F ratio) are not exact binary
// rationals, so identity and round-number expectations carry a small
// floating-point tolerance rather than an exact equality check.
const eps = 1e-6

// TestNormalizeDistance pins the km→mi conversion, the miles/unknown
// identity branch, and boundary values (zero, negative, large). The
// unknown/empty/garbage arms must all fall through to the "assume miles"
// default so a missing SettingDistanceUnit never silently rescales a value.
func TestNormalizeDistance(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"kilometers_to_miles", 160.934, DistKilometers, 100},
		{"kilometers_identity_of_ratio", 1.60934, DistKilometers, 1},
		{"kilometers_zero", 0, DistKilometers, 0},
		{"kilometers_negative", -160.934, DistKilometers, -100},
		{"kilometers_large", 1609340, DistKilometers, 1000000},
		{"miles_identity", 100, DistMiles, 100},
		{"miles_zero", 0, DistMiles, 0},
		{"miles_negative", -42.5, DistMiles, -42.5},
		{"unknown_assumes_miles", 42.5, DistUnknown, 42.5},
		{"empty_assumes_miles", 42.5, "", 42.5},
		{"garbage_unit_assumes_miles", 42.5, "Furlongs", 42.5},
		{"lowercase_km_not_recognized", 100, "kilometers", 100},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := NormalizeDistance(tc.value, tc.fromUnit)
			if math.Abs(got-tc.want) > eps {
				t.Fatalf("NormalizeDistance(%v, %q) = %v; want %v (±%v)", tc.value, tc.fromUnit, got, tc.want, eps)
			}
		})
	}
}

// TestNormalizeSpeed mirrors the distance matrix because speed shares the
// same km/mi ratio, and additionally pins the delegation contract: for any
// (value, unit) pair NormalizeSpeed must equal NormalizeDistance. If the
// two ever diverge (e.g. someone adds a /3600 to one), this fails loudly.
func TestNormalizeSpeed(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"kmh_to_mph", 160.934, DistKilometers, 100},
		{"kmh_zero", 0, DistKilometers, 0},
		{"kmh_negative", -160.934, DistKilometers, -100},
		{"mph_identity", 65, DistMiles, 65},
		{"unknown_assumes_mph", 65, DistUnknown, 65},
		{"empty_assumes_mph", 65, "", 65},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := NormalizeSpeed(tc.value, tc.fromUnit)
			if math.Abs(got-tc.want) > eps {
				t.Fatalf("NormalizeSpeed(%v, %q) = %v; want %v (±%v)", tc.value, tc.fromUnit, got, tc.want, eps)
			}
			// Delegation invariant: speed uses the same ratio as distance.
			if d := NormalizeDistance(tc.value, tc.fromUnit); got != d {
				t.Fatalf("NormalizeSpeed(%v, %q) = %v diverged from NormalizeDistance = %v", tc.value, tc.fromUnit, got, d)
			}
		})
	}
}

// TestNormalizeTemp covers the °F→°C conversion at the anchor points
// (freezing, boiling, the −40 crossover, body temperature) plus the
// Celsius/unknown identity branch. This is the actively-used converter in
// the telemetry recovery/drive-tracking paths, so its edges matter most.
func TestNormalizeTemp(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"fahrenheit_freezing", 32, TempFahrenheit, 0},
		{"fahrenheit_boiling", 212, TempFahrenheit, 100},
		{"fahrenheit_crossover", -40, TempFahrenheit, -40},
		{"fahrenheit_body_temp", 98.6, TempFahrenheit, 37},
		{"fahrenheit_zero", 0, TempFahrenheit, -17.7777777778},
		{"celsius_identity", 25, TempCelsius, 25},
		{"celsius_zero", 0, TempCelsius, 0},
		{"celsius_negative", -10, TempCelsius, -10},
		{"unknown_assumes_celsius", 21, TempUnknown, 21},
		{"empty_assumes_celsius", 21, "", 21},
		{"garbage_unit_assumes_celsius", 21, "Kelvin", 21},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := NormalizeTemp(tc.value, tc.fromUnit)
			if math.Abs(got-tc.want) > eps {
				t.Fatalf("NormalizeTemp(%v, %q) = %v; want %v (±%v)", tc.value, tc.fromUnit, got, tc.want, eps)
			}
		})
	}
}

// TestNormalizePressure covers the bar→psi conversion and the psi/unknown
// identity branch, including zero and negative boundaries.
func TestNormalizePressure(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		value    float64
		fromUnit string
		want     float64
	}{
		{"bar_to_psi", 1, PressBar, 14.5038},
		{"bar_multi", 2.5, PressBar, 36.2595},
		{"bar_zero", 0, PressBar, 0},
		{"bar_negative", -1, PressBar, -14.5038},
		{"psi_identity", 32, PressPSI, 32},
		{"psi_zero", 0, PressPSI, 0},
		{"unknown_assumes_psi", 32, PressUnknown, 32},
		{"empty_assumes_psi", 32, "", 32},
		{"garbage_unit_assumes_psi", 32, "Kilopascal", 32},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := NormalizePressure(tc.value, tc.fromUnit)
			if math.Abs(got-tc.want) > eps {
				t.Fatalf("NormalizePressure(%v, %q) = %v; want %v (±%v)", tc.value, tc.fromUnit, got, tc.want, eps)
			}
		})
	}
}

// TestGetUnitFromSnapshot exercises every branch of the snapshot accessor:
// present string, present-but-empty string, absent key, nil map, and every
// non-string dynamic type (int, float64, bool, nil interface). The
// comma-ok type assertion must never panic and must yield "" for any
// non-string value.
func TestGetUnitFromSnapshot(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		snapshot map[string]interface{}
		signal   string
		want     string
	}{
		{
			name:     "present_string",
			snapshot: map[string]interface{}{"SettingTemperatureUnit": "Fahrenheit"},
			signal:   "SettingTemperatureUnit",
			want:     "Fahrenheit",
		},
		{
			name:     "present_empty_string",
			snapshot: map[string]interface{}{"SettingDistanceUnit": ""},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "absent_key",
			snapshot: map[string]interface{}{"OtherSignal": "Miles"},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "empty_map",
			snapshot: map[string]interface{}{},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "nil_map",
			snapshot: nil,
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "non_string_int",
			snapshot: map[string]interface{}{"SettingDistanceUnit": 5},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "non_string_float",
			snapshot: map[string]interface{}{"SettingDistanceUnit": 3.5},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "non_string_bool",
			snapshot: map[string]interface{}{"SettingDistanceUnit": true},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "non_string_nil_value",
			snapshot: map[string]interface{}{"SettingDistanceUnit": nil},
			signal:   "SettingDistanceUnit",
			want:     "",
		},
		{
			name:     "picks_correct_key_among_many",
			snapshot: map[string]interface{}{"A": "x", "SettingTirePressureUnit": "Bar", "B": 1},
			signal:   "SettingTirePressureUnit",
			want:     "Bar",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := GetUnitFromSnapshot(tc.snapshot, tc.signal)
			if got != tc.want {
				t.Fatalf("GetUnitFromSnapshot(%v, %q) = %q; want %q", tc.snapshot, tc.signal, got, tc.want)
			}
		})
	}
}

// TestUnitConstants_StringValuesStable pins the wire-format strings of the
// Tesla unit-setting constants. These must exactly match the values Tesla
// Fleet reports for SettingDistanceUnit / SettingTemperatureUnit /
// SettingTirePressureUnit; a drift here would silently route every value
// through the "unknown → assume default" branch and corrupt conversions.
func TestUnitConstants_StringValuesStable(t *testing.T) {
	t.Parallel()

	cases := []struct {
		got  string
		want string
	}{
		{DistUnknown, ""},
		{DistMiles, "Miles"},
		{DistKilometers, "Kilometers"},
		{TempUnknown, ""},
		{TempFahrenheit, "Fahrenheit"},
		{TempCelsius, "Celsius"},
		{PressUnknown, ""},
		{PressPSI, "Psi"},
		{PressBar, "Bar"},
	}

	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("unit constant drift: got %q, want %q", tc.got, tc.want)
		}
	}
}

// TestGetUnitFromSnapshot_ThenNormalizeTemp reproduces the real call
// sequence used by the telemetry session trackers: pull the temperature
// unit out of a signal snapshot, then feed it into NormalizeTemp. This
// guards the integration seam between the two functions callers rely on.
func TestGetUnitFromSnapshot_ThenNormalizeTemp(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		snap    map[string]interface{}
		rawTemp float64
		wantC   float64
	}{
		{
			name:    "fahrenheit_snapshot_converts",
			snap:    map[string]interface{}{"SettingTemperatureUnit": TempFahrenheit},
			rawTemp: 68,
			wantC:   20,
		},
		{
			name:    "celsius_snapshot_identity",
			snap:    map[string]interface{}{"SettingTemperatureUnit": TempCelsius},
			rawTemp: 20,
			wantC:   20,
		},
		{
			name:    "missing_unit_defaults_to_celsius",
			snap:    map[string]interface{}{},
			rawTemp: 20,
			wantC:   20,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			unit := GetUnitFromSnapshot(tc.snap, "SettingTemperatureUnit")
			got := NormalizeTemp(tc.rawTemp, unit)
			if math.Abs(got-tc.wantC) > eps {
				t.Fatalf("NormalizeTemp(%v, GetUnitFromSnapshot(...)=%q) = %v; want %v", tc.rawTemp, unit, got, tc.wantC)
			}
		})
	}
}
