package enums

import "strings"

// ParseHvacPower returns true if HVAC is on or preconditioning.
func ParseHvacPower(raw string) bool {
	return strings.Contains(raw, "On") || strings.Contains(raw, "Precondition")
}

// ParseHvacAutoMode strips the "HvacAutoModeState" prefix.
// Tesla sends: "HvacAutoModeStateOn" → "On", "HvacAutoModeStateOff" → "Off".
func ParseHvacAutoMode(raw string) string {
	g := strings.TrimPrefix(raw, PrefixHvacAutoMode)
	if g == "" || g == raw {
		return raw
	}
	return g
}

// ParseCabinOverheatMode normalizes cabin overheat protection mode.
// Check multi-word variants (FanOnly, NoCooling) before single-word (On)
// because "FanOnly" contains the substring "On".
func ParseCabinOverheatMode(raw string) string {
	g := strings.TrimPrefix(raw, "CabinOverheatProtectionModeState")
	switch {
	case strings.Contains(g, "FanOnly"):
		return "Fan Only"
	case strings.Contains(g, "NoCooling"):
		return "No Cooling"
	case strings.Contains(g, "On"):
		return "On"
	case strings.Contains(g, "Off"):
		return "Off"
	}
	if g != "" {
		return g
	}
	return raw
}

// ParseClimateKeeperMode normalizes climate keeper mode.
func ParseClimateKeeperMode(raw string) string {
	g := strings.TrimPrefix(raw, "ClimateKeeperModeState")
	switch {
	case strings.Contains(g, "Off"):
		return "Off"
	case strings.Contains(g, "Dog"):
		return "Dog Mode"
	case strings.Contains(g, "Camp"):
		return "Camp Mode"
	case strings.Contains(g, "On"):
		return "On"
	}
	if g != "" {
		return g
	}
	return raw
}

// ParseDefrostMode normalizes the DefrostMode enum.
// Tesla sends: "DefrostModeStateOff", "DefrostModeStateNormal",
// "DefrostModeStateMax", "DefrostModeStateAutoDefog".
func ParseDefrostMode(raw string) string {
	g := strings.TrimPrefix(raw, PrefixDefrostMode)
	switch g {
	case DefrostOff:
		return DefrostOff
	case DefrostNormal:
		return DefrostNormal
	case DefrostMax:
		return DefrostMax
	case DefrostAutoDefog:
		return DefrostAutoDefog
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}
