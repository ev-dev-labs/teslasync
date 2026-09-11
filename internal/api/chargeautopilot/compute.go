package chargeautopilot

import (
	"fmt"
	"math"
	"sort"
	"time"
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
	if _, _, err := parseReadyBy(p.ReadyBy); err != nil {
		return err
	}
	if !KnownRatePlan(p.RatePlan) {
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

func parseReadyBy(s string) (hour, min int, err error) {
	n, scanErr := fmt.Sscanf(s, "%d:%d", &hour, &min)
	if scanErr != nil || n != 2 || hour < 0 || hour > 23 || min < 0 || min > 59 {
		return 0, 0, fmt.Errorf("ready_by must be HH:MM (24h)")
	}
	return hour, min, nil
}

// NextReadyBy resolves a daily "HH:MM" ready-by time to the next future
// occurrence after now.
func NextReadyBy(readyBy string, now time.Time) (time.Time, error) {
	h, m, err := parseReadyBy(readyBy)
	if err != nil {
		return time.Time{}, err
	}
	next := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next, nil
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
	EffectiveTargetSOC int           `json:"effective_target_soc"`
	CappedByHealth     bool          `json:"capped_by_health_guardrail"`
	ReadyBy            time.Time     `json:"ready_by"`
	KWhNeeded          float64       `json:"kwh_needed"`
	EstDurationHours   float64       `json:"estimated_duration_hours"`
	Window             PreviewWindow `json:"window"`
	ChargeNowCost      float64       `json:"charge_now_cost"`
	OptimizedCost      float64       `json:"optimized_cost"`
	Savings            float64       `json:"savings"`
	SavingsPct         float64       `json:"savings_percent"`
	HourlyRates        []hourlyRate  `json:"hourly_rates"`
	Explanation        string        `json:"explanation"`
}

type hourlyRate struct {
	Hour      int     `json:"hour"`
	RateCents float64 `json:"rate_cents"`
	Tier      string  `json:"tier"`
}

// Preview computes the cheapest contiguous charge window before the next
// ready-by occurrence. Errors are user-facing feasibility problems
// (already at target, not enough time, unknown rate plan).
func Preview(in PreviewInput) (*PreviewResult, error) {
	p := in.Profile
	plan, ok := ratePlans[p.RatePlan]
	if !ok {
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

	kwhNeeded := float64(target-in.CurrentSOC) / 100.0 * p.BatteryCapacityKWh
	chargeRateKW := 240.0 * float64(p.MaxAmps) / 1000.0
	kwhWithLoss := kwhNeeded * 1.10
	durationHours := kwhWithLoss / chargeRateKW
	durationCeil := int(math.Ceil(durationHours))
	if durationCeil <= 0 {
		durationCeil = 1
	}
	if float64(durationCeil) > readyBy.Sub(in.Now).Hours() {
		return nil, fmt.Errorf(
			"not enough time: need %.1f hours but only %.1f hours until ready-by",
			durationHours, readyBy.Sub(in.Now).Hours(),
		)
	}

	rates := buildHourlyRates(plan.Seasons[seasonForDate(plan, readyBy)])

	type candidate struct {
		startHour int
		cost      float64
		avgRate   float64
		tier      string
	}
	var candidates []candidate
	for startH := 0; startH < 24; startH++ {
		start := time.Date(readyBy.Year(), readyBy.Month(), readyBy.Day(), startH, 0, 0, 0, readyBy.Location())
		if start.After(readyBy) {
			start = start.AddDate(0, 0, -1)
		}
		end := start.Add(time.Duration(durationCeil) * time.Hour)
		if start.Before(in.Now) || end.After(readyBy) {
			continue
		}
		cost, avg := costForWindow(rates, startH, durationCeil, kwhNeeded)
		counts := map[string]int{}
		for i := 0; i < durationCeil; i++ {
			counts[rates[(startH+i)%24].Tier]++
		}
		dominant, max := "unknown", 0
		for t, c := range counts {
			if c > max {
				dominant, max = t, c
			}
		}
		candidates = append(candidates, candidate{startH, cost, avg, dominant})
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no valid charging window found before ready-by")
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].cost < candidates[j].cost })
	best := candidates[0]

	chargeNowCost, _ := costForWindow(rates, in.Now.Hour(), durationCeil, kwhNeeded)
	savings := chargeNowCost - best.cost
	savingsPct := 0.0
	if chargeNowCost > 0 {
		savingsPct = savings / chargeNowCost * 100.0
	}

	bestStart := time.Date(readyBy.Year(), readyBy.Month(), readyBy.Day(), best.startHour, 0, 0, 0, readyBy.Location())
	if bestStart.After(readyBy) {
		bestStart = bestStart.AddDate(0, 0, -1)
	}
	bestEnd := bestStart.Add(time.Duration(float64(time.Hour) * durationHours))

	explanation := fmt.Sprintf(
		"Charge %d%% → %d%% (%.1f kWh) in the %s window starting %s to be ready by %s, saving %s vs charging now.",
		in.CurrentSOC, target, round2(kwhNeeded), best.tier,
		bestStart.Format("15:04"), readyBy.Format("15:04"),
		fmtMoney(savings),
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
		KWhNeeded:          round2(kwhNeeded),
		EstDurationHours:   round2(durationHours),
		Window: PreviewWindow{
			StartTime:    bestStart,
			EndTime:      bestEnd,
			RateCentsKWh: round2(best.avgRate * 100),
			EstCost:      round2(best.cost),
			RateTier:     best.tier,
		},
		ChargeNowCost: round2(chargeNowCost),
		OptimizedCost: round2(best.cost),
		Savings:       round2(savings),
		SavingsPct:    round2(savingsPct),
		HourlyRates:   rates,
		Explanation:   explanation,
	}, nil
}

func seasonForDate(plan touPlan, t time.Time) string {
	m := int(t.Month())
	for name, s := range plan.Seasons {
		if s.FromMonth <= s.ToMonth {
			if m >= s.FromMonth && m <= s.ToMonth {
				return name
			}
		} else if m >= s.FromMonth || m <= s.ToMonth {
			return name
		}
	}
	for name := range plan.Seasons {
		return name
	}
	return ""
}

func buildHourlyRates(season touSeason) []hourlyRate {
	rates := make([]hourlyRate, 24)
	for i := range rates {
		rates[i] = hourlyRate{Hour: i, Tier: "unknown"}
	}
	for tier, blocks := range season.Tiers {
		for _, b := range blocks {
			for h := b.Start; h < b.End && h < 24; h++ {
				rates[h] = hourlyRate{Hour: h, RateCents: b.Rate * 100, Tier: tier}
			}
		}
	}
	return rates
}

func costForWindow(rates []hourlyRate, startH, hours int, kwh float64) (cost, avgRate float64) {
	perHour := kwh / float64(hours)
	var sum float64
	for i := 0; i < hours; i++ {
		r := rates[(startH+i)%24]
		sum += r.RateCents / 100 * perHour
	}
	return sum, sum / kwh
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func fmtMoney(f float64) string {
	if f < 0 {
		return fmt.Sprintf("-$%.2f", -f)
	}
	return fmt.Sprintf("$%.2f", f)
}
