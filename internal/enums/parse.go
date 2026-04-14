// Package enums provides centralized Tesla Fleet Telemetry enum parsing.
// Tesla sends enum values as strings like "ShiftStateD", "SentryModeStateArmed",
// "DetailedChargeStateComplete". This package normalizes them to clean values.
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

// IsCharging checks if a DetailedChargeState/ChargeState indicates active charging.
func IsCharging(raw string) bool {
	return strings.Contains(raw, ChargeStateCharging) ||
		strings.Contains(raw, ChargeStateStarting) ||
		raw == "Enable"
}

// IsChargeComplete checks if charging has finished.
func IsChargeComplete(raw string) bool {
	return strings.Contains(raw, ChargeStateComplete)
}

// ParseEnumBool converts a Tesla enum string/bool/number to boolean.
func ParseEnumBool(raw interface{}) bool {
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		return v != "" && !strings.Contains(v, "Off") && v != "false" && v != "0"
	case float64:
		return v != 0
	case int:
		return v != 0
	}
	return false
}

// ParseHvacPower returns true if HVAC is on or preconditioning.
func ParseHvacPower(raw string) bool {
	return strings.Contains(raw, "On") || strings.Contains(raw, "Precondition")
}

// ParseWindowState normalizes window state for display.
func ParseWindowState(raw string) string {
	g := strings.TrimPrefix(raw, "WindowState")
	switch {
	case strings.Contains(g, "Closed"):
		return "Closed"
	case strings.Contains(g, "Partial"):
		return "Partial"
	case strings.Contains(g, "Open"):
		return "Open"
	}
	if g != "" {
		return g
	}
	return raw
}

// ParseChargePortLatch normalizes charge port latch state.
func ParseChargePortLatch(raw string) string {
	g := strings.TrimPrefix(raw, "ChargePortLatch")
	switch {
	case strings.Contains(g, "Engaged"):
		return "Engaged"
	case strings.Contains(g, "Disengaged"):
		return "Disengaged"
	}
	return raw
}

// ParseCabinOverheatMode normalizes cabin overheat protection mode.
func ParseCabinOverheatMode(raw string) string {
	g := strings.TrimPrefix(raw, "CabinOverheatProtectionModeState")
	switch {
	case strings.Contains(g, "On"):
		return "On"
	case strings.Contains(g, "Off"):
		return "Off"
	case strings.Contains(g, "FanOnly"):
		return "Fan Only"
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
