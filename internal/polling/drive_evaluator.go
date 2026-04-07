package polling

// DriveEvaluator assesses vehicle driving activity based on speed and power.
type DriveEvaluator struct{}

func (e *DriveEvaluator) Name() string { return "drive" }

func (e *DriveEvaluator) Evaluate(ctx *EvalContext) EvalResult {
	if ctx.Current == nil {
		return EvalResult{Activity: Idle, Reason: "no data", Confidence: 0.5}
	}

	ds := ctx.Current.DriveState

	// Speed > 0 means actively driving
	if ds.Speed != nil && *ds.Speed > 0 {
		return EvalResult{
			Activity:   Active,
			Reason:     "vehicle is driving (speed > 0)",
			Confidence: 1.0,
		}
	}

	// Power draw/regen without speed can indicate creeping or regen braking
	if ds.Power > 5 || ds.Power < -5 {
		return EvalResult{
			Activity:   Active,
			Reason:     "significant power draw/regen detected",
			Confidence: 0.8,
		}
	}

	// Transition detection: was driving last poll, now stopped — could be a brief stop
	if ctx.Previous != nil && ctx.Previous.DriveState.Speed != nil && *ctx.Previous.DriveState.Speed > 0 {
		return EvalResult{
			Activity:   Moderate,
			Reason:     "recently stopped (was driving last poll)",
			Confidence: 0.7,
		}
	}

	return EvalResult{
		Activity:   Idle,
		Reason:     "vehicle is stationary",
		Confidence: 0.9,
	}
}
