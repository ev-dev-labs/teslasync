package dispatch

import (
	"context"
	"strings"
	"testing"
)

func TestUserPrefs_IsZero(t *testing.T) {
	if !(UserPrefs{}).IsZero() {
		t.Fatalf("zero UserPrefs should report IsZero=true")
	}
	if (UserPrefs{UnitOfLength: "Miles"}).IsZero() {
		t.Fatalf("non-empty UnitOfLength should report IsZero=false")
	}
	if (UserPrefs{DecimalPrecision: 2}).IsZero() {
		t.Fatalf("non-zero DecimalPrecision should report IsZero=false")
	}
}

func TestUserPrefs_SystemMessage_Empty(t *testing.T) {
	if got := (UserPrefs{}).SystemMessage(); got != "" {
		t.Fatalf("zero UserPrefs.SystemMessage = %q, want empty string", got)
	}
}

func TestUserPrefs_SystemMessage_USCustomary(t *testing.T) {
	p := UserPrefs{
		UnitOfLength:     "Miles",
		UnitOfTemp:       "Fahrenheit",
		UnitOfPressure:   "PSI",
		PreferredRange:   "Rated",
		CurrencySymbol:   "$",
		DecimalPrecision: 1,
		Locale:           "en-US",
	}
	got := p.SystemMessage()
	for _, needle := range []string{
		"MILES",
		"MPH",
		"FAHRENHEIT",
		"PSI",
		"Rated",
		`"$"`,
		"1 decimal place",
		"en-US",
		"14.2",
	} {
		if !strings.Contains(got, needle) {
			t.Errorf("SystemMessage missing %q\n--- output ---\n%s", needle, got)
		}
	}
}

func TestUserPrefs_SystemMessage_MetricSI(t *testing.T) {
	p := UserPrefs{
		UnitOfLength:   "Kilometers",
		UnitOfTemp:     "Celsius",
		UnitOfPressure: "kPa",
	}
	got := p.SystemMessage()
	for _, needle := range []string{
		"KILOMETERS",
		"KM/H",
		"CELSIUS",
		"kPa",
	} {
		if !strings.Contains(got, needle) {
			t.Errorf("SystemMessage missing %q\n--- output ---\n%s", needle, got)
		}
	}
	for _, antineedle := range []string{"MILES", "FAHRENHEIT", "PSI"} {
		if strings.Contains(got, antineedle) {
			t.Errorf("SystemMessage unexpectedly contains %q\n--- output ---\n%s", antineedle, got)
		}
	}
}

func TestUserPrefs_SystemMessage_AliasNormalisation(t *testing.T) {
	cases := []struct {
		name string
		p    UserPrefs
		want string
	}{
		{"length lowercase miles", UserPrefs{UnitOfLength: "miles"}, "MILES"},
		{"length mi alias", UserPrefs{UnitOfLength: "mi"}, "MILES"},
		{"length km alias", UserPrefs{UnitOfLength: "km"}, "KILOMETERS"},
		{"length spaced", UserPrefs{UnitOfLength: "  Kilometers  "}, "KILOMETERS"},
		{"temp f alias", UserPrefs{UnitOfTemp: "F"}, "FAHRENHEIT"},
		{"temp °c alias", UserPrefs{UnitOfTemp: "°C"}, "CELSIUS"},
		{"pressure lowercase psi", UserPrefs{UnitOfPressure: "psi"}, "PSI"},
		{"pressure lowercase kpa", UserPrefs{UnitOfPressure: "kpa"}, "kPa"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.p.SystemMessage()
			if !strings.Contains(got, tc.want) {
				t.Fatalf("SystemMessage missing %q\n--- output ---\n%s", tc.want, got)
			}
		})
	}
}

func TestUserPrefs_SystemMessage_UnknownUnitsDropped(t *testing.T) {
	p := UserPrefs{
		UnitOfLength:   "leagues",
		UnitOfTemp:     "rankine",
		UnitOfPressure: "atm",
	}
	got := p.SystemMessage()
	if got != "" {
		t.Fatalf("unknown units should produce empty hint, got %q", got)
	}
}

func TestUserPrefs_ContextRoundTrip(t *testing.T) {
	ctx := context.Background()

	if _, ok := UserPrefsFromContext(ctx); ok {
		t.Fatalf("empty ctx unexpectedly reported prefs present")
	}

	p := UserPrefs{UnitOfLength: "Miles", DecimalPrecision: 1}
	ctx = WithUserPrefs(ctx, p)

	got, ok := UserPrefsFromContext(ctx)
	if !ok {
		t.Fatalf("UserPrefsFromContext after WithUserPrefs reported ok=false")
	}
	if got != p {
		t.Fatalf("round-tripped prefs differ: got %+v want %+v", got, p)
	}
}

func TestUserPrefs_WithNilCtxTolerated(t *testing.T) {
	//nolint:staticcheck // explicit nil tolerance check, mirrors redact.WithPolicy
	ctx := WithUserPrefs(nil, UserPrefs{UnitOfLength: "Miles"})
	if ctx == nil {
		t.Fatalf("WithUserPrefs(nil, ...) returned nil ctx")
	}
	p, ok := UserPrefsFromContext(ctx)
	if !ok || p.UnitOfLength != "Miles" {
		t.Fatalf("WithUserPrefs(nil, ...) did not produce a usable ctx: ok=%v p=%+v", ok, p)
	}
	if _, ok := UserPrefsFromContext(nil); ok {
		t.Fatalf("UserPrefsFromContext(nil) reported ok=true")
	}
}
