package alertmsg

import (
	"context"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
	"golang.org/x/text/number"
)

// SettingsReader is supplied by composition roots, never by the renderer.
type SettingsReader interface {
	Get(context.Context) (*systemmodel.Settings, error)
}

// Preferences applies only to rendered text. MetricUnit describes the existing
// metric registry's input contract; it does not change persisted thresholds.
type Preferences struct {
	Precision     int
	Locale        string
	Distance      string
	Temperature   string
	Pressure      string
	Currency      string
	Timezone      string
	TimezoneMode  string
	MetricUnit    string
	TimeFormat    string
	ReferenceTime time.Time
}

func PreferencesFromSettings(s *systemmodel.Settings) Preferences {
	p := Preferences{Precision: 1, Locale: "en-US", Distance: "km", Temperature: "C", Pressure: "bar", Currency: "$", Timezone: "UTC", TimezoneMode: "vehicle", TimeFormat: "relative"}
	if s == nil {
		return p
	}
	if s.DecimalPrecision >= 0 {
		p.Precision = min(s.DecimalPrecision, 20)
	}
	if strings.TrimSpace(s.Locale) != "" {
		p.Locale = s.Locale
	} else if strings.TrimSpace(s.Language) != "" {
		p.Locale = s.Language
	}
	if s.UnitOfLength == "mi" {
		p.Distance = "mi"
	}
	if s.UnitOfTemp == "F" {
		p.Temperature = "F"
	}
	if s.UnitOfPressure == "psi" {
		p.Pressure = "psi"
	}
	if strings.TrimSpace(s.CurrencySymbol) != "" {
		p.Currency = s.CurrencySymbol
	}
	p.TimezoneMode = s.TzDisplayDefault
	if p.TimezoneMode != "user" && p.TimezoneMode != "utc" {
		p.TimezoneMode = "vehicle"
	}
	if s.TimeFormatDefault == "absolute" {
		p.TimeFormat = "absolute"
	}
	if p.TimezoneMode != "utc" && s.TimezoneUser != "" {
		p.Timezone = s.TimezoneUser
	}
	return p
}

func LoadPreferences(ctx context.Context, reader SettingsReader) (Preferences, error) {
	if reader == nil {
		return PreferencesFromSettings(nil), nil
	}
	s, err := reader.Get(ctx)
	return PreferencesFromSettings(s), err
}

func (p Preferences) WithVehicleTimezone(zone string) Preferences {
	if p.TimezoneMode == "vehicle" && zone != "" && zone != "UTC" {
		p.Timezone = zone
	}
	return p
}

type displayValue struct {
	raw   any
	unit  string
	prefs Preferences
}

func (v displayValue) String() string { return v.render("", true) }

func numeric(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func (v displayValue) render(ownedUnit string, decorate bool) string {
	if v.raw == nil {
		return "—"
	}
	if t, ok := v.raw.(time.Time); ok {
		zone, err := time.LoadLocation(v.prefs.Timezone)
		if err != nil {
			zone = time.UTC
		}
		return t.In(zone).Format(time.RFC3339)
	}
	n, ok := numeric(v.raw)
	if !ok {
		return toString(v.raw)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "—"
	}
	unit := ownedUnit
	if unit == "" {
		switch v.unit {
		case "m", "mi":
			unit = v.prefs.Distance
		case "m/s", "mph":
			unit = "km/h"
			if v.prefs.Distance == "mi" {
				unit = "mph"
			}
		case "m/h":
			unit = v.prefs.Distance + "/h"
		case "C":
			unit = "°" + v.prefs.Temperature
		case "Pa":
			unit = v.prefs.Pressure
		case "Wh", "kwh":
			unit = "kWh"
		case "W", "kw":
			unit = "kW"
		case "currency", "currency_per_mi":
			unit = v.unit
		case "wh_per_mi":
			unit = "Wh/km"
			if v.prefs.Distance == "mi" {
				unit = "Wh/mi"
			}
		default:
			unit = v.unit
		}
	}
	// Metric inputs intentionally retain the registry's existing units.
	// Only signal inputs are SI; no wire/SQL contracts are reinterpreted here.
	switch v.unit {
	case "mi":
		n *= 1609.344
	case "mph":
		n *= 0.44704
	case "kwh", "kw":
		n *= 1000
	}
	switch unit {
	case "km":
		n /= 1000
	case "km/h":
		if v.unit == "m/h" {
			n /= 1000
		} else {
			n *= 3.6
		}
	case "mi":
		n /= 1609.344
	case "mi/h":
		n /= 1609.344
	case "mph":
		n /= 0.44704
	case "°F":
		n = n*9/5 + 32
	case "bar":
		n /= 100000
	case "psi":
		n /= 6894.757293168
	case "kWh", "kW":
		n /= 1000
	case "Wh/km":
		n /= 1.609344
	case "currency_per_mi":
		if v.prefs.Distance == "km" {
			n /= 1.609344
		}
	case "/km":
		if v.unit == "currency_per_mi" {
			n /= 1.609344
		}
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "—"
	}
	tag, err := language.Parse(v.prefs.Locale)
	if err != nil {
		tag = language.MustParse("en-US")
	}
	text := message.NewPrinter(tag).Sprint(number.Decimal(roundHalfExpand(n, v.prefs.Precision), number.MinFractionDigits(v.prefs.Precision), number.MaxFractionDigits(v.prefs.Precision)))
	if !decorate {
		return text
	}
	switch unit {
	case "currency":
		return v.prefs.Currency + text
	case "currency_per_mi":
		return v.prefs.Currency + text + "/" + v.prefs.Distance
	case "%":
		return text + "%"
	case "", "count":
		return text
	default:
		return text + " " + unit
	}
}

// Intl.NumberFormat (fmtNumber) uses halfExpand; x/text uses halfEven.
// Round the shortest decimal representation first, without binary scaling
// errors such as 1.005 * 100, then let x/text own locale/grouping/padding.
func roundHalfExpand(n float64, precision int) float64 {
	decimal := strconv.FormatFloat(math.Abs(n), 'f', -1, 64)
	if dot := strings.IndexByte(decimal, '.'); dot < 0 || len(decimal)-dot-1 <= precision {
		return n
	}
	r, ok := new(big.Rat).SetString(decimal)
	if !ok {
		return n
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(precision)), nil)
	scaled := new(big.Int).Mul(r.Num(), scale)
	rounded, remainder := new(big.Int), new(big.Int)
	rounded.QuoRem(scaled, r.Denom(), remainder)
	if remainder.Lsh(remainder, 1).Cmp(r.Denom()) >= 0 {
		rounded.Add(rounded, big.NewInt(1))
	}
	out, _ := new(big.Rat).SetFrac(rounded, scale).Float64()
	return math.Copysign(out, n)
}

func signalUnit(name string) string {
	meta := protomodel.SignalsByName[name]
	if meta == nil || meta.IsSettingUnit {
		return ""
	}
	switch meta.ValueKind {
	case protomodel.ValueKindFloat, protomodel.ValueKindDouble, protomodel.ValueKindInt32, protomodel.ValueKindInt64:
	default:
		return ""
	}
	switch meta.UnitKind {
	case protomodel.UnitKindDistance:
		if name == "ChargeRateMilePerHour" {
			return "m/h"
		}
		return "m"
	case protomodel.UnitKindTemperature:
		return "C"
	case protomodel.UnitKindPressure:
		return "Pa"
	case protomodel.UnitKindCharge:
		return "%"
	}
	// Fixed-SI exceptions match the canonical pipeline's explicit overrides.
	switch name {
	case "VehicleSpeed", "CruiseSetSpeed", "MaxSpeedToReachDestinationMph", "SemiCruiseSpeedLimitMph":
		return "m/s"
	case "ACChargingPower", "DCChargingPower":
		return "W"
	case "ACChargingEnergyIn", "DCChargingEnergyIn", "LifetimeEnergyChargedKwh", "NominalFullPackEnergyKwh":
		return "Wh"
	}
	return ""
}

func applyPreferences(ctx Context, rule *alertmodel.AlertRule, p Preferences) {
	applyTimestampPreferences(ctx, p)
	for key, raw := range ctx {
		unit := signalUnit(key)
		measurement := numericSignal(key)
		switch key {
		case "Value", "Threshold", "Min", "Max":
			measurement = true
			if rule != nil {
				unit = signalUnit(rule.SignalName)
				if meta := protomodel.SignalsByName[rule.SignalName]; meta != nil {
					measurement = numericSignal(rule.SignalName)
				}
			}
		case "MetricValue", "MetricPrevValue", "MetricThreshold":
			measurement, unit = true, p.MetricUnit
			if key == "MetricThreshold" && rule != nil && strings.HasPrefix(strDeref(rule.MetricOp), "%_change_") {
				unit = "%"
			}
		case "MetricChangePct":
			measurement, unit = true, "%"
		case "Now":
			if s, ok := raw.(string); ok {
				if t, err := time.Parse(time.RFC3339, s); err == nil {
					raw = t
				}
			}
			measurement = true
		}
		if measurement {
			ctx[key] = displayValue{raw: raw, unit: unit, prefs: p}
		}
	}
}

func contextValue(ctx Context, key string, fallback any) string {
	if v, ok := ctx[key]; ok {
		return toString(v)
	}
	return toString(fallback)
}

// Literal units belong to custom template text. Convert to that explicit unit
// instead of appending a second suffix or relabeling an incompatible value.
func templateOwnedUnit(after, source string) string {
	after = strings.TrimLeft(after, " \t")
	var units []string
	switch source {
	case "m", "mi":
		units = []string{"km", "mi", "m"}
	case "m/s", "mph":
		units = []string{"km/h", "mph", "m/s"}
	case "m/h":
		units = []string{"km/h", "mi/h", "m/h"}
	case "C":
		units = []string{"°C", "°F"}
	case "Pa":
		units = []string{"bar", "psi", "Pa"}
	case "Wh", "kwh":
		units = []string{"kWh", "Wh"}
	case "W", "kw":
		units = []string{"kW", "W"}
	case "%":
		units = []string{"%"}
	case "wh_per_mi":
		units = []string{"Wh/mi", "Wh/km"}
	case "currency":
		units = []string{"$", "€", "£", "¥", "₹"}
	case "currency_per_mi":
		units = []string{"/mi", "/km"}
	case "h", "pp":
		units = []string{source}
	}
	for _, unit := range units {
		if strings.HasPrefix(after, unit) && (len(after) == len(unit) || !isUnitLetter(after[len(unit)])) {
			return unit
		}
	}
	return ""
}

func isUnitLetter(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '/' }

func templateOwnsCurrency(before, configured string) bool {
	for _, symbol := range []string{configured, "$", "€", "£", "¥", "₹"} {
		if symbol != "" && strings.HasSuffix(before, symbol) {
			return true
		}
	}
	return false
}

func placeholderSample(p Placeholder, rule *alertmodel.AlertRule) any {
	if p.Key == "Now" {
		return time.Now().UTC()
	}
	switch p.Key {
	case "Value":
		if rule != nil {
			if rule.ValueText != nil {
				return *rule.ValueText
			}
			if rule.ValueBool != nil && rule.ValueNum == nil {
				return *rule.ValueBool
			}
			if meta := protomodel.SignalsByName[rule.SignalName]; meta != nil {
				switch meta.ValueKind {
				case protomodel.ValueKindBool:
					return true
				case protomodel.ValueKindString, protomodel.ValueKindEnum:
					return "sample"
				}
			}
		}
		return 18.2345
	case "MetricValue", "MetricPrevValue":
		return 18.2345
	case "Threshold":
		if rule != nil && protomodel.SignalsByName[rule.SignalName] != nil && !numericSignal(rule.SignalName) {
			return placeholderSample(Placeholder{Key: "Value"}, rule)
		}
		return 20.0
	case "MetricThreshold", "Min", "Max":
		return 20.0
	case "MetricChangePct":
		return 12.3456
	}
	if meta := protomodel.SignalsByName[p.Key]; meta != nil {
		switch meta.ValueKind {
		case protomodel.ValueKindBool:
			return true
		case protomodel.ValueKindInt32, protomodel.ValueKindInt64, protomodel.ValueKindFloat, protomodel.ValueKindDouble:
			return 82.4567
		default:
			return "sample"
		}
	}
	return p.Example
}

func numericSignal(key string) bool {
	if meta := protomodel.SignalsByName[key]; meta != nil {
		switch meta.ValueKind {
		case protomodel.ValueKindInt32, protomodel.ValueKindInt64, protomodel.ValueKindFloat, protomodel.ValueKindDouble:
			return true
		}
	}
	return false
}

// SampleContext supplies typed examples, not parsed or preformatted strings.
func SampleContext(rule *alertmodel.AlertRule, p Preferences) Context {
	samples := map[string]any{}
	for _, placeholder := range Placeholders(rule) {
		samples[placeholder.Key] = placeholderSample(placeholder, rule)
	}
	samples["MetricWindow"] = "day"
	return BuildContext(rule, "Falcon", samples, nil, p)
}
