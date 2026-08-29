// Package counter provides unit-agnostic validation and delta semantics for
// monotonically increasing telemetry counters.
package counter

import "math"

// ChangeKind classifies the relationship between two counter observations.
type ChangeKind uint8

const (
	// ChangeInvalid means at least one observation is negative or non-finite.
	ChangeInvalid ChangeKind = iota
	// ChangeUnchanged means both observations carry the same value.
	ChangeUnchanged
	// ChangeAdvanced means the current observation is greater than the prior
	// observation and Delta is safe to attribute to the interval.
	ChangeAdvanced
	// ChangeReset means the current observation is below the prior observation.
	// The current absolute value is a new baseline, not attributable distance
	// or energy.
	ChangeReset
)

// Change is the classified result of comparing consecutive observations.
type Change struct {
	Kind  ChangeKind
	Delta float64
}

// Valid reports whether value can participate in cumulative-counter math.
func Valid(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

// Compare classifies consecutive cumulative-counter values. Resets and
// invalid observations deliberately return a zero delta so callers cannot
// accidentally attribute an absolute post-reset value to an interval.
func Compare(previous, current float64) Change {
	if !Valid(previous) || !Valid(current) {
		return Change{Kind: ChangeInvalid}
	}
	if current < previous {
		return Change{Kind: ChangeReset}
	}
	if current == previous {
		return Change{Kind: ChangeUnchanged}
	}
	return Change{
		Kind:  ChangeAdvanced,
		Delta: current - previous,
	}
}
