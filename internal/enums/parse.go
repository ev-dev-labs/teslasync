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

// ParseBuckleStatus converts Tesla's BuckleStatus enum to a boolean.
// Tesla sends seatbelt signals as enum strings: "BuckleStatusLatched" (buckled)
// or "BuckleStatusUnlatched" (unbuckled), but may also send raw booleans.
func ParseBuckleStatus(raw interface{}) bool {
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		return v == "BuckleStatusLatched"
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

// ParseChargePort normalizes charge port state.
// Tesla sends: "ChargePortOpen", "ChargePortClosed".
func ParseChargePort(raw string) string {
	g := strings.TrimPrefix(raw, PrefixChargePort)
	switch {
	case strings.Contains(g, "Open"):
		return "Open"
	case strings.Contains(g, "Closed"):
		return "Closed"
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseChargePortLatch normalizes charge port latch state.
// Tesla sends: "ChargePortLatchEngaged", "ChargePortLatchDisengaged".
func ParseChargePortLatch(raw string) string {
	g := strings.TrimPrefix(raw, PrefixChargePortLatch)
	switch {
	case strings.Contains(g, "Engaged"):
		return "Engaged"
	case strings.Contains(g, "Disengaged"):
		return "Disengaged"
	}
	if g != "" && g != raw {
		return g
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

// ParseForwardCollisionWarning normalizes the FCW sensitivity enum.
// Tesla sends: "ForwardCollisionSensitivityOff", "ForwardCollisionSensitivityLate",
// "ForwardCollisionSensitivityAverage", "ForwardCollisionSensitivityEarly".
func ParseForwardCollisionWarning(raw string) string {
	g := strings.TrimPrefix(raw, PrefixForwardCollision)
	switch g {
	case "Off":
		return "Off"
	case "Late":
		return "Late"
	case "Average":
		return "Average"
	case "Early":
		return "Early"
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseLaneDepartureAvoidance normalizes the LDA mode enum.
// Tesla sends: "LaneAssistLevelOff", "LaneAssistLevelWarning", "LaneAssistLevelAssist".
func ParseLaneDepartureAvoidance(raw string) string {
	g := strings.TrimPrefix(raw, PrefixLaneAssist)
	switch g {
	case "Off":
		return "Off"
	case "Warning":
		return "Warning"
	case "Assist":
		return "Assist"
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseSpeedLimitWarning normalizes the speed limit warning enum.
// Tesla sends: "SpeedAssistLevelNone", "SpeedAssistLevelDisplay", "SpeedAssistLevelChime".
func ParseSpeedLimitWarning(raw string) string {
	g := strings.TrimPrefix(raw, PrefixSpeedAssist)
	switch g {
	case "None":
		return "Off"
	case "Display":
		return "Display"
	case "Chime":
		return "Chime"
	case "Off":
		return "Off"
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseBMSState normalizes the BMS state enum.
// Tesla sends: "BMSStateStandby", "BMSStateDrive", "BMSStateSupport",
// "BMSStateCharge", "BMSStateFault".
func ParseBMSState(raw string) string {
	g := strings.TrimPrefix(raw, PrefixBMSState)
	switch g {
	case "Standby":
		return BMSStandby
	case "Drive":
		return BMSDrive
	case "Support":
		return BMSSupport
	case "Charge":
		return BMSCharge
	case "Fault":
		return BMSFault
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseCruiseFollowDistance normalizes the follow-distance enum.
// Tesla sends: "FollowDistance1" through "FollowDistance7".
func ParseCruiseFollowDistance(raw string) string {
	g := strings.TrimPrefix(raw, PrefixFollowDistance)
	if len(g) == 1 && g[0] >= '1' && g[0] <= '7' {
		return g
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}
