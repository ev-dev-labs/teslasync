package polling

import "github.com/ev-dev-labs/teslasync/internal/enums"

// ChargeEvaluator assesses vehicle charging activity based on charging state,
// charge port status, and charge rate.
type ChargeEvaluator struct{}

func (e *ChargeEvaluator) Name() string { return "charge" }

func (e *ChargeEvaluator) Evaluate(ctx *EvalContext) EvalResult {
	if ctx.Current == nil {
		return EvalResult{Activity: Idle, Reason: "no data", Confidence: 0.5}
	}

	cs := ctx.Current.ChargeState

	switch cs.ChargingState {
	case enums.ChargeStateCharging:
		return EvalResult{
			Activity:   Active,
			Reason:     "actively charging",
			Confidence: 1.0,
		}

	case enums.ChargeStateStarting:
		return EvalResult{
			Activity:   Active,
			Reason:     "charge session starting",
			Confidence: 1.0,
		}

	case enums.ChargeStateComplete:
		if cs.ChargePortLatch == "Engaged" || cs.ChargePortDoorOpen {
			return EvalResult{
				Activity:   Low,
				Reason:     "charge complete, charger still plugged in",
				Confidence: 0.9,
			}
		}
		return EvalResult{
			Activity:   Idle,
			Reason:     "charge complete, charger disconnected",
			Confidence: 0.9,
		}

	case enums.ChargeStateStopped:
		if cs.ChargePortLatch == "Engaged" || cs.ChargePortDoorOpen {
			return EvalResult{
				Activity:   Low,
				Reason:     "charge stopped but charger plugged in",
				Confidence: 0.8,
			}
		}
		return EvalResult{
			Activity:   Idle,
			Reason:     "charge stopped",
			Confidence: 0.8,
		}

	case enums.ChargeStateDisconnected, enums.ChargeStateNoPower:
		return EvalResult{
			Activity:   Idle,
			Reason:     "no charger connected",
			Confidence: 0.9,
		}
	}

	// Fallback: check charge rate directly
	if cs.ChargeRate > 0 || cs.ChargerPower > 0 {
		return EvalResult{
			Activity:   Active,
			Reason:     "charge current detected",
			Confidence: 0.8,
		}
	}

	return EvalResult{
		Activity:   Idle,
		Reason:     "no charging activity",
		Confidence: 0.7,
	}
}
