package alertmsg

import (
	"math"
	"testing"
	"time"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

func TestDisplayPreferences(t *testing.T) {
	tests := []struct {
		name, signal, template, want string
		value                        any
		settings                     systemmodel.Settings
	}{
		{"precision locale", "Soc", "  {{Value}} / {{Threshold}}\n", "  18,2346% / 20,0000%\n", 18.23456,
			systemmodel.Settings{DecimalPrecision: 4, Locale: "de-DE"}},
		{"zero precision", "Soc", "{{Value}}%", "0%", 0.0,
			systemmodel.Settings{DecimalPrecision: 0, Locale: "en-US"}},
		{"Intl positive half", "Soc", "{{Value}}", "2.3%", 2.25,
			systemmodel.Settings{DecimalPrecision: 1}},
		{"Intl negative half", "Soc", "{{Value}}", "-2.3%", -2.25,
			systemmodel.Settings{DecimalPrecision: 1}},
		{"Intl decimal half", "Soc", "{{Value}}", "1.01%", 1.005,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"speed", "VehicleSpeed", "{{Value}}", "60.00 mph", 26.8224,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfLength: "mi"}},
		{"explicit speed suffix", "VehicleSpeed", "{{Value}} km/h", "96.56 km/h", 26.8224,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfLength: "mi"}},
		{"distance", "Odometer", "{{Value}}", "1,234.00 km", 1234000.0,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"temperature", "InsideTemp", "{{Value}}", "77.00 °F", 25.0,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfTemp: "F"}},
		{"pressure Pa bridge", "TpmsPressureFl", "{{Value}}", "43.51 psi", 300000.0,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfPressure: "psi"}},
		{"explicit pressure", "TpmsPressureFl", "{{Value}} bar", "3.00 bar", 300000.0,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfPressure: "psi"}},
		{"energy", "ACChargingEnergyIn", "{{Value}}", "12.35 kWh", 12345.67,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"power", "ACChargingPower", "{{Value}}", "12.35 kW", 12345.67,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"range rate not speed", "ChargeRateMilePerHour", "{{Value}}", "10.00 mi/h", 16093.44,
			systemmodel.Settings{DecimalPrecision: 2, UnitOfLength: "mi"}},
		{"HVAC bool", "HvacPower", "{{Value}} / {{HvacPower}}", "true / true", true,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"raw numeric text", "Odometer", "{{Value}}", "001234.50", "001234.50",
			systemmodel.Settings{DecimalPrecision: 2}},
		{"empty text", "Gear", "v={{Value}}", "v=", "",
			systemmodel.Settings{DecimalPrecision: 2}},
		{"null measurement", "Soc", "{{Value}}%", "—%", nil,
			systemmodel.Settings{DecimalPrecision: 2}},
		{"NaN", "Soc", "{{Value}}", "—", math.NaN(),
			systemmodel.Settings{DecimalPrecision: 2}},
		{"infinity", "VehicleSpeed", "{{Value}}", "—", math.Inf(1),
			systemmodel.Settings{DecimalPrecision: 2}},
		{"conversion overflow", "VehicleSpeed", "{{Value}}", "—", math.MaxFloat64,
			systemmodel.Settings{DecimalPrecision: 2}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rule := &alertmodel.AlertRule{Name: "Rule", Kind: "signal", SignalName: tc.signal, Op: ">", ValueNum: fp(20), MsgTemplate: sp(tc.template)}
			signals := map[string]any{tc.signal: tc.value}
			ctx := BuildContext(rule, "Falcon", signals, nil, PreferencesFromSettings(&tc.settings))
			if got := RenderBody(rule, ctx); got != tc.want {
				t.Fatalf("body = %q, want %q", got, tc.want)
			}
			if rule.ValueNum == nil || *rule.ValueNum != 20 {
				t.Fatal("formatting changed the raw threshold")
			}
		})
	}
}

func TestDisplayDefaultsRangesAndText(t *testing.T) {
	p := PreferencesFromSettings(&systemmodel.Settings{DecimalPrecision: 2, Locale: "de-DE", UnitOfLength: "mi"})
	rule := &alertmodel.AlertRule{Name: "Speed", Kind: "signal", SignalName: "VehicleSpeed", Op: "between", ValueMin: fp(0), ValueMax: fp(26.8224), IncludeTitle: false}
	ctx := BuildContext(rule, "00123", map[string]any{"VehicleSpeed": 0.0, "Gear": "D", "HvacPower": false}, map[string]any{"PlaceID": int64(1234)}, p)
	if got := RenderBody(rule, ctx); got != "Vehicle Speed 0,00 mph · expected 0,00 mph–60,00 mph" {
		t.Fatal(got)
	}
	if got := Substitute("{{VehicleName}}|{{PlaceID}}|{{Gear}}|{{HvacPower}}|{{ Unknown }}", ctx); got != "00123|1234|D|false|{{ Unknown }}" {
		t.Fatal(got)
	}
	if title := RenderTitle(rule, ctx); title != "00123 — Speed" {
		t.Fatal(title)
	}
	if got := RenderTitle(nil, ctx); got != "Alert" {
		t.Fatal(got)
	}
}

func TestDisplayTimestampAndCurrency(t *testing.T) {
	settings := &systemmodel.Settings{DecimalPrecision: 2, Locale: "de-DE", CurrencySymbol: "€", TzDisplayDefault: "user", TimezoneUser: "America/Los_Angeles"}
	p := PreferencesFromSettings(settings)
	p.MetricUnit = "currency"
	rule := &alertmodel.AlertRule{Kind: "computed_metric", MetricID: sp("charging_cost"), MetricThreshold: fp(1000), MetricOp: sp(">")}
	ctx := BuildContext(rule, "", nil, map[string]any{"Now": time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC), "MetricValue": 1234.567}, p)
	want := "€1.234,57|€1.000,00|2026-01-02T04:00:00-08:00"
	if got := Substitute("{{MetricValue}}|{{MetricThreshold}}|{{Now}}", ctx); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := Substitute("€{{MetricValue}}", ctx); got != "€1.234,57" {
		t.Fatal(got)
	}
	if got := Substitute("${{MetricValue}} / {{MetricValue}} €", ctx); got != "$1.234,57 / 1.234,57 €" {
		t.Fatal(got)
	}
	p.TimezoneMode = "vehicle"
	p = p.WithVehicleTimezone("Asia/Kolkata")
	ctx = BuildContext(rule, "", nil, map[string]any{"Now": time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)}, p)
	if got := Substitute("{{Now}}", ctx); got != "2026-01-02T17:30:00+05:30" {
		t.Fatal(got)
	}
	p.Timezone = "invalid timezone"
	ctx = BuildContext(rule, "", nil, map[string]any{"Now": time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)}, p)
	if got := Substitute("{{Now}}", ctx); got != "2026-01-02T12:00:00Z" {
		t.Fatal(got)
	}
}

func TestDisplayMetricContracts(t *testing.T) {
	tests := []struct {
		unit  string
		value float64
		want  string
	}{
		{"mi", 10, "16,0934 km"},
		{"mph", 60, "96,5606 km/h"},
		{"kwh", 12.3456, "12,3456 kWh"},
		{"kw", 12.3456, "12,3456 kW"},
		{"h", 1.23456, "1,2346 h"},
		{"wh_per_mi", 160.9344, "100,0000 Wh/km"},
		{"currency_per_mi", 1.609344, "€1,0000/km"},
	}

	for _, tc := range tests {
		t.Run(tc.unit, func(t *testing.T) {
			p := PreferencesFromSettings(&systemmodel.Settings{DecimalPrecision: 4, Locale: "de-DE", CurrencySymbol: "€"})
			p.MetricUnit = tc.unit
			rule := &alertmodel.AlertRule{Kind: "computed_metric"}
			ctx := BuildContext(rule, "", nil, map[string]any{"MetricValue": tc.value}, p)
			if got := Substitute("{{MetricValue}}", ctx); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDisplayLanguageAndInvalidPreferences(t *testing.T) {
	rule := &alertmodel.AlertRule{Kind: "signal", SignalName: "Soc"}
	p := PreferencesFromSettings(&systemmodel.Settings{DecimalPrecision: 2, Language: "de"})
	ctx := BuildContext(rule, "", map[string]any{"Soc": 1234.56}, nil, p)
	if got := Substitute("{{Value}}", ctx); got != "1.234,56%" {
		t.Fatal(got)
	}
	p = PreferencesFromSettings(&systemmodel.Settings{DecimalPrecision: -1, Locale: "invalid!!"})
	ctx = BuildContext(rule, "", map[string]any{"Soc": 1234.56}, nil, p)
	if got := Substitute("{{Value}}", ctx); got != "1,234.6%" {
		t.Fatal(got)
	}
	ctx = BuildContext(&alertmodel.AlertRule{SignalName: "Gear"}, "", map[string]any{"Gear": int64(1234)}, nil, p)
	if got := Substitute("{{Value}}|{{Gear}}", ctx); got != "1234|1234" {
		t.Fatal(got)
	}
}
