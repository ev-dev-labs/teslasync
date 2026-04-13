package fsm

// GuardNoCharge returns true when the vehicle is NOT charging.
// Used to prevent Driving/Online → Parked when charge is active (should go to Charging instead).
func GuardNoCharge(ctx *SignalContext) bool {
	return !ctx.IsCharging
}

// GuardNoGear returns true only if this vehicle has NEVER received a Gear signal.
// Tesla delta streaming sends Gear only on CHANGE — a 2-hour highway drive has
// ONE Gear=D at start, then silence. If we used TTL-based "freshness", the speed
// fallback would activate mid-drive and red lights would end the drive session.
//
// Once a vehicle has ever sent Gear, it is a Fleet Telemetry vehicle and ONLY
// gear-based transitions should be used. The speed fallback is exclusively for
// REST API polling vehicles that never receive Gear signals.
func GuardNoGear(ctx *SignalContext) bool {
	return !ctx.IsGearCapable
}

// GuardUnexpectedLoss returns true when the vehicle was in an active state
// (Driving or Charging) before losing contact. This distinguishes "unexpected
// offline" from normal sleep (Parked/Online → Asleep).
func GuardUnexpectedLoss(ctx *SignalContext) bool {
	return ctx.CurrentState == Driving || ctx.CurrentState == Charging
}
