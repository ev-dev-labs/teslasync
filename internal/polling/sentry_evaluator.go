package polling

// SentryEvaluator checks whether sentry mode is active. Sentry mode keeps
// the vehicle awake and may generate events, warranting slightly more frequent
// polling than a fully idle vehicle.
type SentryEvaluator struct{}

func (e *SentryEvaluator) Name() string { return "sentry" }

func (e *SentryEvaluator) Evaluate(ctx *EvalContext) EvalResult {
	if ctx.Current == nil {
		return EvalResult{Activity: Idle, Reason: "no data", Confidence: 0.5}
	}

	if ctx.Current.VehicleState.SentryMode {
		return EvalResult{
			Activity:   Low,
			Reason:     "sentry mode active (vehicle is watching)",
			Confidence: 0.6,
		}
	}

	return EvalResult{
		Activity:   Idle,
		Reason:     "sentry mode off",
		Confidence: 0.7,
	}
}
