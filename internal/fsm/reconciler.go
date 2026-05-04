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

// reconcileSignalSource is the narrow set of typed accessors the
// reconciler needs. *SignalAdapter satisfies it; tests can pass a
// fake to drive deriveExpectedState directly without standing up a
// real backing store.
//
// The interface deliberately mirrors only the methods used by
// deriveExpectedState — adding methods here is a contract change and
// MUST be reflected in the adapter and any test fakes.
type reconcileSignalSource interface {
	Last(vehicleID int64, field string) (signal.Value, bool)
	Gear(vehicleID int64) (string, bool)
	Speed(vehicleID int64) (float64, bool)
	IsCharging(vehicleID int64) (bool, bool)
}

// reconcileFields lists the canonical proto field names the
// reconciler considers when deriving expected state. Order is not
// significant — the freshest timestamp across the set drives the
// staleness gate, then per-field freshness drives the priority
// ladder.
var reconcileFields = [...]string{
	"Gear",
	"DetailedChargeState",
	"ChargeState",
	"ChargeAmps",
	"VehicleSpeed",
}

// deriveExpectedState is the adapter-driven core of the reconciler.
// It is unexported because the public entry point lives in
// signal_adapter_compat.go (DeriveExpectedState) — that wrapper
// constructs a *SignalAdapter for callers that still hold a raw
// signal store and dispatches here.
//
// Pure function — no side effects. Returns ConfidenceNone when
// signals are too stale or insufficient to make a determination.
//
// Only Driving, Charging, and Parked are returned as expected
// states. Online, Asleep, and Offline are "absence of evidence"
// states that the reconciler cannot safely assert.
func deriveExpectedState(vehicleID int64, src reconcileSignalSource, now time.Time) ReconcileResult {
	result := ReconcileResult{Confidence: ConfidenceNone, Reason: "insufficient signals"}

	freshest := time.Time{}
	for _, f := range reconcileFields {
		if v, ok := src.Last(vehicleID, f); ok && v.Timestamp.After(freshest) {
			freshest = v.Timestamp
		}
	}

	// All signals stale or missing → cannot reconcile.
	if freshest.IsZero() || now.Sub(freshest) > SignalFreshnessThreshold {
		return result
	}
	result.FreshestAt = freshest

	isFresh := func(field string) bool {
		v, ok := src.Last(vehicleID, field)
		return ok && now.Sub(v.Timestamp) <= SignalFreshnessThreshold
	}

	// Determine charging status: DetailedChargeState / ChargeState
	// are handled by the adapter (which strips proto enum prefixes
	// and recognises only the symbolic Charging/Starting suffixes).
	// ChargeAmps is a pure-numeric fallback for vehicles where the
	// charge-state enum is not yet known but draw is observable.
	charging := false
	if isFresh("DetailedChargeState") || isFresh("ChargeState") {
		if active, ok := src.IsCharging(vehicleID); ok {
			charging = active
		}
	}
	if !charging && isFresh("ChargeAmps") {
		if v, ok := src.Last(vehicleID, "ChargeAmps"); ok {
			if f, fOk := toFloat(v.Raw); fOk && f > 1.0 {
				charging = true
			}
		}
	}

	// Priority 1: Gear signal (highest confidence).
	// SignalAdapter.Gear normalises proto enum names to short
	// suffixes ("P", "R", "N", "D"); see signal_adapter.go.
	if isFresh("Gear") {
		if gear, ok := src.Gear(vehicleID); ok {
			switch gear {
			case "D", "R":
				return ReconcileResult{
					ExpectedState: Driving,
					Confidence:    ConfidenceHigh,
					FreshestAt:    freshest,
					Reason:        "Gear=" + gear,
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
	}

	// Priority 2: Charge state without gear (medium confidence).
	if charging {
		return ReconcileResult{
			ExpectedState: Charging,
			Confidence:    ConfidenceMedium,
			FreshestAt:    freshest,
			Reason:        "charge state active (no gear)",
		}
	}

	// Priority 3: Speed without gear (low confidence — REST API
	// polling vehicles that never receive Gear signals).
	if isFresh("VehicleSpeed") {
		if speed, ok := src.Speed(vehicleID); ok && speed > 1.0 {
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
