package chargingsvc

import (
	"math"
	"slices"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
)

// ObserveCharger retains positive evidence across sparse batches and the final
// zero-power batch. It performs no I/O on the telemetry hot path.
func ObserveCharger(e *charging.ChargerEvidence, signals map[string]any) {
	fastPresent, hasFastPresent := signals["FastChargerPresent"].(bool)
	acPower, _ := evidenceNumber(signals["ACChargingPower"])
	acOnly := hasFastPresent && !fastPresent && acPower > 0
	if value, ok := signals["FastChargerPresent"].(bool); ok && value {
		e.FastPresent = true
	}
	if value, ok := signals["FastChargerType"].(string); !acOnly && ok && !slices.Contains(e.FastChargerTypes, value) {
		e.FastChargerTypes = append(e.FastChargerTypes, value)
	}
	if value, ok := signals["FastChargerBrand"].(string); !acOnly && ok && value != "" {
		e.Brand = value
	}
	for _, field := range []struct {
		name   string
		target *float64
	}{
		{"ACChargingPower", &e.ACPowerW},
		{"DCChargingPower", &e.DCPowerW},
		{"ChargerVoltage", &e.VoltageV},
	} {
		if acOnly && field.name == "DCChargingPower" {
			continue
		}
		if value, ok := evidenceNumber(signals[field.name]); ok && value > *field.target {
			*field.target = value
		}
	}
	if value, ok := evidenceNumber(signals["ChargerPhases"]); ok && (value == 1 || value == 3) {
		e.Phases = int(value)
	}
}

func evidenceNumber(value any) (float64, bool) {
	var number float64
	switch value := value.(type) {
	case float64:
		number = value
	case int:
		number = float64(value)
	case int32:
		number = float64(value)
	case int64:
		number = float64(value)
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}
