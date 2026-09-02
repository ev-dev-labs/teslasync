package fsm

import "time"

// SignalContext is the pre-processed input to the FSM, built once per signal batch.
// Guards and the trigger detector read from this struct.
type SignalContext struct {
	// Current FSM state (before this evaluation).
	CurrentState State

	// Gear
	Gear           string // "D", "R", "P", "N" or ""
	HasGearInBatch bool   // Gear signal is present in THIS telemetry batch
	IsGearCapable  bool   // Vehicle has EVER received a Gear signal (lifetime flag).
	//                       Once true, speed-based fallback is permanently disabled.
	//                       Tesla delta streaming sends Gear only on CHANGE —
	//                       a 2-hour drive has ONE Gear=D at start, then silence.

	// Speed
	Speed     float64
	WasMoving bool // Had Speed > 0 within driveHoldDuration

	// Charging
	IsCharging         bool   // DetailedChargeState is actively transferring energy
	ChargeState        string // Canonical charge-state short form when present in this batch
	ChargeStateChanged bool   // ChargeState/DetailedChargeState present in this batch

	// Raw signal maps — forwarded to sub-FSMs and actions.
	Signals            map[string]interface{}
	AccumulatedSignals map[string]interface{}

	// Timestamps
	Now time.Time

	// Matched transition metadata (populated after lookup, used by LogTransition).
	MatchedTrigger string
	MatchedGuard   string
	TransitionMode string
}
