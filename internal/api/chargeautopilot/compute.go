package chargeautopilot

import (
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/tou"
)

// Profile is the wire shape for an Autopilot configuration.
type Profile struct {
	VehicleID          int64   `json:"vehicle_id"`
	Enabled            bool    `json:"enabled"`
	TargetSOC          int     `json:"target_soc"`
	ReadyBy            string  `json:"ready_by"` // daily "HH:MM"
	RatePlan           string  `json:"rate_plan"`
	DailyCapSOC        int     `json:"daily_cap_soc"`
	TripOverride       bool    `json:"trip_override"`
	Precondition       bool    `json:"precondition"`
	MaxAmps            int     `json:"max_amps"`
	BatteryCapacityKWh float64 `json:"battery_capacity_kwh"`
}

// DefaultProfile returns the out-of-box profile for a vehicle.
func DefaultProfile(vehicleID int64) Profile {
	return Profile{
		VehicleID:          vehicleID,
		Enabled:            false,
		TargetSOC:          80,
		ReadyBy:            "07:30",
		RatePlan:           "pge-ev2a",
		DailyCapSOC:        80,
		TripOverride:       false,
		Precondition:       true,
		MaxAmps:            32,
		BatteryCapacityKWh: 75,
	}
}

// ValidateProfile rejects out-of-range configuration before persistence.
func ValidateProfile(p Profile) error {
	if p.VehicleID <= 0 {
		return fmt.Errorf("vehicle_id is required")
	}
	if p.TargetSOC < 20 || p.TargetSOC > 100 {
		return fmt.Errorf("target_soc must be 20..100")
	}
	if p.DailyCapSOC < 50 || p.DailyCapSOC > 100 {
		return fmt.Errorf("daily_cap_soc must be 50..100")
	}
	if _, _, err := tou.ParseClock(p.ReadyBy); err != nil {
		return err
	}
	if !tou.KnownPlan(p.RatePlan) {
		return fmt.Errorf("unknown rate plan: %s", p.RatePlan)
	}
	if p.MaxAmps < 8 || p.MaxAmps > 80 {
		return fmt.Errorf("max_amps must be 8..80")
	}
	if p.BatteryCapacityKWh <= 0 || p.BatteryCapacityKWh > 250 {
		return fmt.Errorf("battery_capacity_kwh must be positive")
	}
	return nil
}

// EffectiveTarget applies the battery-health guardrail: without a trip
// override the charge target is capped at the daily cap (default 80%).
// Returns the effective target and whether the cap engaged.
func EffectiveTarget(target, dailyCap int, tripOverride bool) (int, bool) {
	if !tripOverride && target > dailyCap {
		return dailyCap, true
	}
	return target, false
}

// KnownRatePlan reports whether id names a supported TOU plan.
func KnownRatePlan(id string) bool {
	return tou.KnownPlan(id)
}

func parseReadyBy(s string) (hour, min int, err error) {
	return tou.ParseClock(s)
}

// NextReadyBy resolves a daily "HH:MM" ready-by time to the next future
// occurrence after now.
func NextReadyBy(readyBy string, now time.Time) (time.Time, error) {
	return tou.NextClockTime(readyBy, now)
}

// ── Preview engine (pure, no I/O) ────────────────────────────

// PreviewInput seeds a next-run preview.
type PreviewInput struct {
	Profile    Profile
	CurrentSOC int
	Now        time.Time
}

// PreviewWindow is one priced charge window.
type PreviewWindow struct {
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
	RateCentsKWh float64   `json:"rate_cents_kwh"`
	EstCost      float64   `json:"estimated_cost"`
	RateTier     string    `json:"rate_tier"`
}

// PreviewResult is the next-run preview: cheapest window, charge-now
// comparison, guardrail outcome, and a human-readable explanation.
type PreviewResult struct {
	EffectiveTargetSOC int              `json:"effective_target_soc"`
	CappedByHealth     bool             `json:"capped_by_health_guardrail"`
	ReadyBy            time.Time        `json:"ready_by"`
	KWhNeeded          float64          `json:"kwh_needed"`
	EstDurationHours   float64          `json:"estimated_duration_hours"`
	Window             PreviewWindow    `json:"window"`
	ChargeNowCost      float64          `json:"charge_now_cost"`
	OptimizedCost      float64          `json:"optimized_cost"`
	Savings            float64          `json:"savings"`
	SavingsPct         float64          `json:"savings_percent"`
	HourlyRates        []tou.HourlyRate `json:"hourly_rates"`
	Explanation        string           `json:"explanation"`
}

// Preview computes the cheapest contiguous charge window before the next
// ready-by occurrence. Errors are user-facing feasibility problems
// (already at target, not enough time, unknown rate plan).
func Preview(in PreviewInput) (*PreviewResult, error) {
	p := in.Profile
	if !tou.KnownPlan(p.RatePlan) {
		return nil, fmt.Errorf("unknown rate plan: %s", p.RatePlan)
	}
	target, capped := EffectiveTarget(p.TargetSOC, p.DailyCapSOC, p.TripOverride)
	if in.CurrentSOC >= target {
		return nil, fmt.Errorf("current SOC (%d%%) already meets target (%d%%)", in.CurrentSOC, target)
	}
	readyBy, err := NextReadyBy(p.ReadyBy, in.Now)
	if err != nil {
		return nil, err
	}

	result, err := tou.FindWindow(tou.WindowInput{
		PlanID: p.RatePlan, CurrentSOC: in.CurrentSOC, TargetSOC: target,
		Now: in.Now, Deadline: readyBy,
		BatteryCapacityKWh: p.BatteryCapacityKWh, ChargerVoltage: 240,
		MaxAmps: p.MaxAmps, DeadlineLabel: "ready-by",
	})
	if err != nil {
		return nil, err
	}
	best := result.Best

	explanation := fmt.Sprintf(
		"Charge %d%% → %d%% (%.1f kWh) in the %s window starting %s to be ready by %s, saving %s vs charging now.",
		in.CurrentSOC, target, tou.Round2(result.KWhNeeded), best.Tier,
		best.StartTime.Format("15:04"), readyBy.Format("15:04"),
		fmtMoney(result.Savings),
	)
	if capped {
		explanation += fmt.Sprintf(" Health guardrail capped the %d%% request to %d%% for daily driving.", p.TargetSOC, target)
	}
	if p.Precondition {
		explanation += " Cabin/battery preconditioning runs before departure."
	}

	return &PreviewResult{
		EffectiveTargetSOC: target,
		CappedByHealth:     capped,
		ReadyBy:            readyBy,
		KWhNeeded:          tou.Round2(result.KWhNeeded),
		EstDurationHours:   tou.Round2(result.DurationHours),
		Window: PreviewWindow{
			StartTime:    best.StartTime,
			EndTime:      best.EndTime,
			RateCentsKWh: tou.Round2(best.AvgRateCents),
			EstCost:      tou.Round2(best.Cost),
			RateTier:     best.Tier,
		},
		ChargeNowCost: tou.Round2(result.ChargeNowCost),
		OptimizedCost: tou.Round2(result.OptimizedCost),
		Savings:       tou.Round2(result.Savings),
		SavingsPct:    tou.Round2(result.SavingsPct),
		HourlyRates:   result.HourlyRates,
		Explanation:   explanation,
	}, nil
}

func fmtMoney(f float64) string {
	if f < 0 {
		return fmt.Sprintf("-$%.2f", -f)
	}
	return fmt.Sprintf("$%.2f", f)
}
