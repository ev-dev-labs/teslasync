package fsm

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Confidence indicates how certain we are about the derived state.
type Confidence int

const (
	ConfidenceNone   Confidence = iota // Cannot determine — stale or missing signals
	ConfidenceLow                      // Speed-only inference
	ConfidenceMedium                   // Charge state only (no gear)
	ConfidenceHigh                     // Gear signal present
)

// String returns a human-readable name for the confidence level.
func (c Confidence) String() string {
	switch c {
	case ConfidenceNone:
		return "none"
	case ConfidenceLow:
		return "low"
	case ConfidenceMedium:
		return "medium"
	case ConfidenceHigh:
		return "high"
	default:
		return "unknown"
	}
}

// ReconcileResult holds the output of DeriveExpectedState.
type ReconcileResult struct {
	ExpectedState State
	Confidence    Confidence
	FreshestAt    time.Time // Most recent signal timestamp used
	Reason        string    // Human-readable explanation
}

// SignalFreshnessThreshold is the maximum age for a signal to be considered fresh.
// Signals older than this are ignored for reconciliation.
const SignalFreshnessThreshold = 2 * time.Minute

// DeriveExpectedState examines current signal values and determines what FSM
// state the vehicle should be in. Returns ConfidenceNone if signals are too
// stale or insufficient to make a determination.
//
// Only Driving, Charging, and Parked are returned as expected states.
// Online, Asleep, and Offline are "absence of evidence" states that the
// reconciler cannot safely assert.
//
// This is a pure function with no side effects. It does NOT mutate the FSM.
func DeriveExpectedState(vehicleID int64, store *signal.Store, now time.Time) ReconcileResult {
	result := ReconcileResult{Confidence: ConfidenceNone, Reason: "insufficient signals"}

	gear := store.Get(vehicleID, "Gear")
	dcs := store.Get(vehicleID, "DetailedChargeState")
	cs := store.Get(vehicleID, "ChargeState")
	amps := store.Get(vehicleID, "ChargeAmps")
	speed := store.Get(vehicleID, "VehicleSpeed")

	// Find freshest signal across all key signals.
	freshest := time.Time{}
	for _, v := range []*signal.Value{gear, dcs, cs, amps, speed} {
		if v != nil && v.Timestamp.After(freshest) {
			freshest = v.Timestamp
		}
	}

	// All signals stale or missing → cannot reconcile.
	if freshest.IsZero() || now.Sub(freshest) > SignalFreshnessThreshold {
		return result
	}
	result.FreshestAt = freshest

	// Determine charging status: DetailedChargeState > ChargeState > ChargeAmps
	charging := false
	if dcs != nil && isFresh(dcs, now) {
		charging = isChargingState(toString(dcs.Raw))
	}
	if !charging && cs != nil && isFresh(cs, now) {
		charging = isChargingState(toString(cs.Raw))
	}
	if !charging && amps != nil && isFresh(amps, now) {
		if f, ok := toFloat(amps.Raw); ok && f > 1.0 {
			charging = true
		}
	}

	// Priority 1: Gear signal (highest confidence)
	if gear != nil && isFresh(gear, now) {
		gearStr := toString(gear.Raw)
		switch gearStr {
		case "D", "R":
			return ReconcileResult{
				ExpectedState: Driving,
				Confidence:    ConfidenceHigh,
				FreshestAt:    freshest,
				Reason:        "Gear=" + gearStr,
			}
		case "P":
			if charging {
				return ReconcileResult{
					ExpectedState: Charging,
					Confidence:    ConfidenceHigh,
					FreshestAt:    freshest,
					Reason:        "Gear=P + charging",
				}
			}
			return ReconcileResult{
				ExpectedState: Parked,
				Confidence:    ConfidenceHigh,
				FreshestAt:    freshest,
				Reason:        "Gear=P + not charging",
			}
		}
	}

	// Priority 2: Charge state without gear (medium confidence)
	if charging {
		return ReconcileResult{
			ExpectedState: Charging,
			Confidence:    ConfidenceMedium,
			FreshestAt:    freshest,
			Reason:        "charge state active (no gear)",
		}
	}

	// Priority 3: Speed without gear (low confidence, REST API polling vehicles)
	if speed != nil && isFresh(speed, now) {
		if f, ok := toFloat(speed.Raw); ok && f > 1.0 {
			return ReconcileResult{
				ExpectedState: Driving,
				Confidence:    ConfidenceLow,
				FreshestAt:    freshest,
				Reason:        "speed > 1.0 (no gear)",
			}
		}
	}

	return result
}

// isFresh returns true if a signal value is within the freshness threshold.
func isFresh(v *signal.Value, now time.Time) bool {
	return v != nil && now.Sub(v.Timestamp) <= SignalFreshnessThreshold
}
