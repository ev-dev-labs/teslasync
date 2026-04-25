package units

// Tesla SettingDistanceUnit values
const (
	DistUnknown    = ""
	DistMiles      = "Miles"
	DistKilometers = "Kilometers"
)

// Tesla SettingTemperatureUnit values
const (
	TempUnknown    = ""
	TempFahrenheit = "Fahrenheit"
	TempCelsius    = "Celsius"
)

// Tesla SettingTirePressureUnit values
const (
	PressUnknown = ""
	PressPSI     = "Psi"
	PressBar     = "Bar"
)

// NormalizeDistance converts a distance value to miles.
func NormalizeDistance(value float64, fromUnit string) float64 {
	switch fromUnit {
	case DistKilometers:
		return value / 1.60934
	default:
		return value // Miles or unknown → assume miles
	}
}

// NormalizeSpeed converts a speed value to mph.
func NormalizeSpeed(value float64, fromUnit string) float64 {
	return NormalizeDistance(value, fromUnit) // same ratio
}

// NormalizeTemp converts a temperature value to °C.
func NormalizeTemp(value float64, fromUnit string) float64 {
	switch fromUnit {
	case TempFahrenheit:
		return (value - 32) * 5 / 9
	default:
		return value // Celsius or unknown → assume Celsius
	}
}

// NormalizePressure converts a pressure value to PSI.
func NormalizePressure(value float64, fromUnit string) float64 {
	switch fromUnit {
	case PressBar:
		return value * 14.5038
	default:
		return value // PSI or unknown → assume PSI
	}
}

// GetUnitFromSnapshot extracts a unit preference from a signal snapshot.
func GetUnitFromSnapshot(snapshot map[string]interface{}, signalName string) string {
	if v, ok := snapshot[signalName]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
