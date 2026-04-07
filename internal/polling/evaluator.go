package polling

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ActivityLevel represents how active a vehicle is. Higher levels indicate
// more frequent polling is needed. The engine uses the highest level returned
// by any evaluator to determine the polling interval.
type ActivityLevel int

const (
	// Sleeping — vehicle returned 408 (asleep). Do not poll; let it sleep.
	Sleeping ActivityLevel = -1
	// Idle — parked, nothing changing. Aggressive backoff (5 min → 15 min → 30 min).
	Idle ActivityLevel = 0
	// Low — minor activity such as sentry mode on or charge complete but plugged in.
	Low ActivityLevel = 1
	// Moderate — preconditioning, scheduled charge upcoming, or similar.
	Moderate ActivityLevel = 2
	// Active — actively driving or charging. Poll at state-specific rate.
	Active ActivityLevel = 3
	// Critical — state transition detected. Poll immediately.
	Critical ActivityLevel = 4
)

// String returns a human-readable name for the activity level.
func (a ActivityLevel) String() string {
	switch a {
	case Sleeping:
		return "sleeping"
	case Idle:
		return "idle"
	case Low:
		return "low"
	case Moderate:
		return "moderate"
	case Active:
		return "active"
	case Critical:
		return "critical"
	default:
		return "unknown"
	}
}

// EvalContext provides the data each evaluator needs to make its assessment.
// It includes the current API response, the previous response (for delta
// detection), elapsed time, and the vehicle's committed state from the DB.
type EvalContext struct {
	Current       *tesla.VehicleDataResponse
	Previous      *tesla.VehicleDataResponse // nil on first poll
	TimeSinceLast time.Duration
	VehicleState  string // from DB: "driving", "charging", "parked", "online", "asleep"
}

// EvalResult is the output of a single evaluator.
type EvalResult struct {
	Activity   ActivityLevel
	Reason     string  // human-readable explanation for logs/dashboard
	Confidence float64 // 0.0–1.0, weight in the final decision
}

// SignalEvaluator inspects one aspect of a vehicle's response and returns
// an activity level. Implement this interface to add new polling signals
// without touching the engine or other evaluators.
type SignalEvaluator interface {
	// Name returns a short identifier for this evaluator (e.g., "drive", "charge").
	Name() string
	// Evaluate inspects the context and returns an activity assessment.
	Evaluate(ctx *EvalContext) EvalResult
}
