package polling

// ClimateEvaluator assesses vehicle climate system activity.
type ClimateEvaluator struct{}

func (e *ClimateEvaluator) Name() string { return "climate" }

func (e *ClimateEvaluator) Evaluate(ctx *EvalContext) EvalResult {
	if ctx.Current == nil {
		return EvalResult{Activity: Idle, Reason: "no data", Confidence: 0.5}
	}

	cl := ctx.Current.ClimateState

	// Preconditioning indicates imminent departure
	if cl.IsPreconditioning {
		return EvalResult{
			Activity:   Moderate,
			Reason:     "preconditioning active (possible imminent departure)",
			Confidence: 0.9,
		}
	}

	// Climate actively running
	if cl.IsClimateOn {
		return EvalResult{
			Activity:   Moderate,
			Reason:     "climate control is on",
			Confidence: 0.8,
		}
	}

	// Fan running without climate (e.g., cabin overheat protection)
	if cl.FanStatus > 0 {
		return EvalResult{
			Activity:   Low,
			Reason:     "fan running (cabin overheat protection or cooldown)",
			Confidence: 0.6,
		}
	}

	return EvalResult{
		Activity:   Idle,
		Reason:     "climate system off",
		Confidence: 0.9,
	}
}
