package polling

import "math"

// BatteryEvaluator detects battery level changes between polls.
// Unchanged battery is a strong signal that nothing interesting is happening.
type BatteryEvaluator struct{}

func (e *BatteryEvaluator) Name() string { return "battery" }

func (e *BatteryEvaluator) Evaluate(ctx *EvalContext) EvalResult {
	if ctx.Current == nil {
		return EvalResult{Activity: Idle, Reason: "no data", Confidence: 0.5}
	}

	// No previous data to compare — first poll
	if ctx.Previous == nil {
		return EvalResult{
			Activity:   Low,
			Reason:     "first poll, no baseline for comparison",
			Confidence: 0.3,
		}
	}

	currentLevel := ctx.Current.ChargeState.BatteryLevel
	previousLevel := ctx.Previous.ChargeState.BatteryLevel
	delta := math.Abs(float64(currentLevel - previousLevel))

	currentRange := ctx.Current.ChargeState.BatteryRange
	previousRange := ctx.Previous.ChargeState.BatteryRange
	rangeDelta := math.Abs(currentRange - previousRange)

	// Significant battery change (≥2%) indicates active driving or charging
	if delta >= 2 {
		return EvalResult{
			Activity:   Active,
			Reason:     "battery level changed significantly",
			Confidence: 0.9,
		}
	}

	// Small battery change (1%) or range drift
	if delta >= 1 || rangeDelta >= 5 {
		return EvalResult{
			Activity:   Low,
			Reason:     "minor battery level or range change",
			Confidence: 0.7,
		}
	}

	// No change at all
	return EvalResult{
		Activity:   Idle,
		Reason:     "battery level unchanged",
		Confidence: 0.9,
	}
}
