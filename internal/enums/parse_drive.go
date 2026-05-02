package enums

import "strings"

// ParseGear normalizes Tesla ShiftState enum to single letter.
func ParseGear(raw string) string {
	g := strings.TrimPrefix(raw, PrefixShiftState)
	switch {
	case g == GearDrive || strings.Contains(g, "Drive"):
		return GearDrive
	case g == GearReverse || strings.Contains(g, "Reverse"):
		return GearReverse
	case g == GearPark || strings.Contains(g, "Park"):
		return GearPark
	case g == GearNeutral || strings.Contains(g, "Neutral"):
		return GearNeutral
	}
	return ""
}
