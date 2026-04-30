package telemetry

import "github.com/rs/zerolog/log"

// SignalAliases maps deprecated/renamed Tesla signal names to canonical names.
// When Tesla renames a signal, add a mapping here — all downstream code uses
// the canonical name and never needs to change.
//
// Update this map when Tesla publishes Fleet Telemetry API changes.
var SignalAliases = map[string]string{
	// Example (not active yet):
	// "BatteryStateOfCharge": "BatteryLevel",
	// "VehicleSpeedKph":     "VehicleSpeed",
}

// Canonicalize returns the canonical signal name, applying aliases if needed.
func Canonicalize(signal string) string {
	if canonical, ok := SignalAliases[signal]; ok {
		log.Debug().Str("old", signal).Str("new", canonical).Msg("signal alias applied")
		return canonical
	}
	return signal
}

// CanonicalizeMap rewrites signal keys in-place, replacing any aliased names
// with their canonical equivalents. This is the map-based entry point for
// ProcessSignals which operates on map[string]interface{}.
func CanonicalizeMap(signals map[string]interface{}) {
	for name, value := range signals {
		if canonical, ok := SignalAliases[name]; ok {
			log.Debug().Str("old", name).Str("new", canonical).Msg("signal alias applied")
			delete(signals, name)
			signals[canonical] = value
		}
	}
}
