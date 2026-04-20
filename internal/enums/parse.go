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

// ParseChargeState normalizes ChargeState enum.
// Tesla sends: "ChargeStateCharging", "ChargeStateComplete", etc.
// Also normalizes the special "Enable" value to "Charging".
func ParseChargeState(raw string) string {
	g := strings.TrimPrefix(raw, "ChargeState")
	switch g {
	case "Charging":
		return ChargeStateCharging
	case "Complete":
		return ChargeStateComplete
	case "Disconnected":
		return ChargeStateDisconnected
	case "NoPower":
		return ChargeStateNoPower
	case "Starting":
		return ChargeStateStarting
	case "Stopped":
		return ChargeStateStopped
	case "Enable":
		return ChargeStateCharging
	}
	// "Enable" without prefix
	if raw == "Enable" {
		return ChargeStateCharging
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseDetailedChargeState normalizes DetailedChargeState enum.
// Tesla sends: "DetailedChargeStateCharging", "DetailedChargeStateComplete", etc.
func ParseDetailedChargeState(raw string) string {
	g := strings.TrimPrefix(raw, PrefixDetailedCharge)
	switch g {
	case "Charging":
		return ChargeStateCharging
	case "Complete":
		return ChargeStateComplete
	case "Disconnected":
		return ChargeStateDisconnected
	case "NoPower":
		return ChargeStateNoPower
	case "Starting":
		return ChargeStateStarting
	case "Stopped":
		return ChargeStateStopped
	case "Error":
		return "Error"
	}
	if g != "" && g != raw {
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

// ParseSentryMode normalizes the SentryMode enum.
// Tesla sends: "SentryModeStateArmed", "SentryModeStateOff", "SentryModeStateIdle", etc.
func ParseSentryMode(raw string) string {
	g := strings.TrimPrefix(raw, PrefixSentryMode)
	switch g {
	case "Off":
		return SentryOff
	case "Idle":
		return SentryIdle
	case "Armed":
		return SentryArmed
	case "Aware":
		return SentryAware
	case "Panic":
		return SentryPanic
	case "Quiet":
		return SentryQuiet
	}
	if g != "" && g != raw {
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

// ParseScheduledChargingMode normalizes the scheduled charging mode enum.
// Tesla sends: "ScheduledChargingModeOff", "ScheduledChargingModeStartAt",
// "ScheduledChargingModeDepartBy", "ScheduledChargingModeUnknown".
func ParseScheduledChargingMode(raw string) string {
	g := strings.TrimPrefix(raw, PrefixScheduledChargingMode)
	switch g {
	case "Off":
		return "Off"
	case "StartAt":
		return "StartAt"
	case "DepartBy":
		return "DepartBy"
	case "Unknown":
		return "Unknown"
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseCenterDisplay normalizes the center display state enum.
// Tesla sends: "DisplayStateOff", "DisplayStateDim", "DisplayStateAccessory",
// "DisplayStateOn", "DisplayStateDriving", "DisplayStateCharging",
// "DisplayStateLock", "DisplayStateSentry", "DisplayStateDog", "DisplayStateEntertainment".
func ParseCenterDisplay(raw string) string {
	g := strings.TrimPrefix(raw, PrefixDisplayState)
	switch g {
	case "Off":
		return DisplayOff
	case "Dim":
		return DisplayDim
	case "Accessory":
		return DisplayAccessory
	case "On":
		return DisplayOn
	case "Driving":
		return DisplayDriving
	case "Charging":
		return DisplayCharging
	case "Lock":
		return DisplayLock
	case "Sentry":
		return DisplaySentry
	case "Dog":
		return DisplayDog
	case "Entertainment":
		return DisplayEntertainment
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

// ParseTurnSignal normalizes the turn-signal enum.
// Tesla sends: "TurnSignalStateOff", "TurnSignalStateLeft", "TurnSignalStateRight",
// or the shorter "TurnSignalOff", "TurnSignalLeft", "TurnSignalRight".
func ParseTurnSignal(raw string) string {
	// Try longer prefix first: "TurnSignalState"
	g := strings.TrimPrefix(raw, PrefixTurnSignal)
	if g == raw {
		// Try shorter prefix: "TurnSignal"
		g = strings.TrimPrefix(raw, "TurnSignal")
	}
	switch g {
	case "Off", "Left", "Right", "Both":
		return g
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseTonneauPosition normalizes the tonneau cover position enum.
// Tesla sends: "TonneauPositionStateClosed", "TonneauPositionStateOpen", etc.
func ParseTonneauPosition(raw string) string {
	g := strings.TrimPrefix(raw, PrefixTonneauPosition)
	switch g {
	case "Closed", "Open", "PartiallyOpen", "Moving", "Unknown":
		return g
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParseTonneauTentMode normalizes the tonneau tent mode enum.
// Tesla sends: "TonneauTentModeActive", "TonneauTentModeOff", etc.
func ParseTonneauTentMode(raw string) string {
	g := strings.TrimPrefix(raw, PrefixTonneauTentMode)
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParsePowershareStatus normalizes the Powershare status enum.
// Tesla sends: "PowershareStateActive", "PowershareStateInactive", "PowershareStateUnknown".
func ParsePowershareStatus(raw string) string {
	g := strings.TrimPrefix(raw, PrefixPowershareState)
	switch g {
	case "Active", "Inactive", "Unknown":
		return g
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParsePowershareStopReason normalizes the Powershare stop reason enum.
// Tesla sends: "PowershareStopReasonUserRequest", "PowershareStopReasonLowBattery", etc.
func ParsePowershareStopReason(raw string) string {
	g := strings.TrimPrefix(raw, PrefixPowershareStopReason)
	switch g {
	case "UserRequest", "LowBattery", "Error", "None":
		return g
	}
	if g != "" && g != raw {
		return g
	}
	return raw
}

// ParsePowershareType normalizes the Powershare type enum.
// Tesla sends: "PowershareTypeHome", "PowershareTypeVehicle", "PowershareTypeNone".
func ParsePowershareType(raw string) string {
	g := strings.TrimPrefix(raw, PrefixPowershareType)
	switch g {
	case "Home", "Vehicle", "None":
		return g
	}
	if g != "" && g != raw {
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
