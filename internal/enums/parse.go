// Package enums provides centralized Tesla Fleet Telemetry enum parsing.
// Tesla sends enum values as strings like "ShiftStateD", "SentryModeStateArmed",
// "DetailedChargeStateComplete". This package normalizes them to clean values.
package enums

import "strings"

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
