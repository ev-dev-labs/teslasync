package charging

import (
	"math"
	"strings"
)

// ChargerEvidence contains observations from one charging session, not the
// vehicle's last reading after charging has stopped.
type ChargerEvidence struct {
	FastChargerTypes []string
	FastPresent      bool
	Brand            string
	ACPowerW         float64
	DCPowerW         float64
	PeakPowerW       float64
	AveragePowerW    float64
	Phases           int
	VoltageV         float64
	RecordedType     string
	Place            string
}

// ClassifyCharger returns the persisted charger kind; an empty kind means
// unknown. Home is a location attribute, never a charger kind.
func ClassifyCharger(e ChargerEvidence) string {
	dc := e.FastPresent || positive(e.DCPowerW) ||
		aboveACLimit(e.PeakPowerW) || aboveACLimit(e.AveragePowerW) || aboveACLimit(e.ACPowerW)
	ac := positive(e.ACPowerW) || ((e.Phases == 1 || e.Phases == 3) && positive(e.VoltageV))
	tesla := false
	for _, charger := range e.FastChargerTypes {
		switch strings.ToLower(strings.TrimSpace(charger)) {
		case "supercharger":
			tesla, dc = true, true
		case "chademo", "gb", "combo", "mcsinglewirecan", "other":
			dc = true
		case "acsinglewirecan":
			ac = true
		}
	}
	if dc {
		if tesla || strings.EqualFold(strings.TrimSpace(e.Brand), "Tesla") ||
			strings.Contains(strings.ToLower(e.Place), "supercharger") ||
			strings.Contains(strings.ToLower(e.RecordedType), "supercharger") {
			return "Supercharger"
		}
		return "DC"
	}
	if ac {
		return "AC"
	}
	switch strings.ToLower(strings.TrimSpace(e.RecordedType)) {
	case "supercharger", "tesla supercharger":
		return "Supercharger"
	case "dc", "dc fast", "ccs", "chademo":
		return "DC"
	case "ac", "home", "home ac", "ac/home", "home / ac", "wall connector":
		return "AC"
	default:
		return ""
	}
}

func positive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func aboveACLimit(value float64) bool {
	return positive(value) && value > 22000
}
