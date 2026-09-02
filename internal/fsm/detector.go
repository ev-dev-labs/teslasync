package fsm

import (
	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// DetectTriggers maps raw telemetry signals to FSM triggers.
// Returns triggers in priority order: gear > charge > speed.
//
// Speed-based triggers are ONLY produced for vehicles that have NEVER received
// a Gear signal (IsGearCapable == false). Tesla delta streaming sends Gear only
// on change — a 2-hour drive has one Gear=D at start, then silence. If we used
// TTL-based freshness, the speed fallback would activate mid-drive and red
// lights would end the drive session.
func DetectTriggers(sctx *SignalContext) []Trigger {
	var triggers []Trigger

	// Priority 1: Gear signals (authoritative from MCU)
	if sctx.HasGearInBatch {
		switch sctx.Gear {
		case enums.GearDrive, enums.GearReverse:
			triggers = append(triggers, TriggerGearDriving)
		case enums.GearPark:
			if sctx.IsCharging {
				triggers = append(triggers, TriggerChargeStarted)
			} else {
				triggers = append(triggers, TriggerGearParked)
			}
		}
	}

	// Priority 2: Charge state changes.
	// Tesla Stopped/Complete/NoPower/Unknown mean still plugged (or unknown).
	// Only unplug (Disconnected) ends the charge session.
	if sctx.ChargeStateChanged {
		if sctx.IsCharging {
			triggers = append(triggers, TriggerChargeStarted)
		} else if enums.IsChargeEnded(sctx.ChargeState) {
			triggers = append(triggers, TriggerChargeEnded)
		}
	}

	// Priority 3: Speed-based (ONLY for REST API polling vehicles — never received Gear)
	if !sctx.IsGearCapable {
		if sctx.Speed > 1.0 {
			triggers = append(triggers, TriggerSpeedDetected)
		}
		if sctx.Speed == 0 && sctx.WasMoving {
			triggers = append(triggers, TriggerSpeedZero)
		}
	}

	return triggers
}
