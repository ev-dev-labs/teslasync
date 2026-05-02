package enums

import "strings"

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
