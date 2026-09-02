package enums

import "strings"

// Charging-state predicates the FSM/session layers depend on. The codec
// emits canonical short strings ("Charging", "Starting", "Complete",
// ...) into signal.Store per the protomodel.DecodeValue contract; these
// helpers are simple textual predicates over those strings — they are
// NOT a translation layer (the codec is the SINGLE conversion point).
//
// strings.Contains is preserved here (rather than a strict ==) for
// resilience against the historical Tesla Fleet API JSON poll path
// that emitted long-form values like "ChargeStateCharging" before the
// telemetry-pipeline cutover. After ADR-004 closes the legacy poll
// path, these can collapse to ==.

// IsCharging reports whether the canonical charge-state short form
// indicates an active charging session.
func IsCharging(raw string) bool {
	return strings.Contains(raw, ChargeStateCharging) ||
		strings.Contains(raw, ChargeStateStarting) ||
		raw == "Enable"
}

// IsChargeComplete reports whether the canonical charge-state short
// form indicates a finished charging session.
func IsChargeComplete(raw string) bool {
	return strings.Contains(raw, ChargeStateComplete)
}

func isExplicitChargeState(raw, state string) bool {
	return raw == state ||
		raw == "ChargeState"+state ||
		raw == "DetailedChargeState"+state
}

// IsChargeEnded reports whether a charge-state transition means the cable is
// unplugged. Tesla Stopped is a pause (schedule, user pause, Supercharger
// hold). Complete is charge-limit reached while still plugged. NoPower is
// plugged with a dead EVSE. Unknown is not evidence. None of those end a
// session. Only Disconnected is unplug.
func IsChargeEnded(raw string) bool {
	return isExplicitChargeState(raw, ChargeStateDisconnected)
}
