package tou

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// WindowInput contains the canonical charge-window inputs used by both callers.
type WindowInput struct {
	PlanID             string
	CurrentSOC         int
	TargetSOC          int
	Now                time.Time
	Deadline           time.Time
	BatteryCapacityKWh float64
	ChargerVoltage     int
	MaxAmps            int
	DeadlineLabel      string
}

// WindowCandidate is one scored contiguous candidate window.
type WindowCandidate struct {
	StartHour    int
	StartTime    time.Time
	EndTime      time.Time
	Cost         float64
	AvgRateCents float64
	Tier         string
}

// WindowResult is the canonical result shared by planner and autopilot.
type WindowResult struct {
	KWhNeeded     float64
	DurationHours float64
	DurationCeil  int
	Best          WindowCandidate
	Alternatives  []WindowCandidate
	ChargeNowCost float64
	OptimizedCost float64
	Savings       float64
	SavingsPct    float64
	HourlyRates   []HourlyRate
}

// AddWallHours adds whole hours while retaining wall-clock semantics across DST.
func AddWallHours(start time.Time, hours int) time.Time {
	if hours == 0 {
		return start
	}
	totalHour := start.Hour() + hours
	dayOffset := 0
	if totalHour >= 24 {
		dayOffset = totalHour / 24
		totalHour %= 24
	} else if totalHour < 0 {
		dayOffset = (totalHour - 23) / 24
		totalHour -= dayOffset * 24
	}
	base := start
	if dayOffset != 0 {
		base = base.AddDate(0, 0, dayOffset)
	}
	return time.Date(base.Year(), base.Month(), base.Day(), totalHour, start.Minute(), start.Second(), start.Nanosecond(), start.Location())
}

// AddWallDuration adds fractional wall-clock hours without converting through
// elapsed 24-hour durations.
func AddWallDuration(start time.Time, durationHours float64) time.Time {
	totalMinutes := int(math.Round(durationHours * 60))
	return time.Date(
		start.Year(), start.Month(), start.Day(),
		start.Hour(), start.Minute()+totalMinutes, start.Second(), start.Nanosecond(), start.Location(),
	)
}

// WallHoursBetween measures elapsed wall-clock hours, excluding DST offset changes.
func WallHoursBetween(start, end time.Time) float64 {
	startWall := time.Date(start.Year(), start.Month(), start.Day(), start.Hour(), start.Minute(), start.Second(), start.Nanosecond(), time.UTC)
	endWall := time.Date(end.Year(), end.Month(), end.Day(), end.Hour(), end.Minute(), end.Second(), end.Nanosecond(), time.UTC)
	return endWall.Sub(startWall).Hours()
}

// FindWindow calculates the cheapest bounded contiguous window.
func FindWindow(in WindowInput) (*WindowResult, error) {
	plan, ok := GetPlan(in.PlanID)
	if !ok {
		return nil, fmt.Errorf("unknown rate plan: %s", in.PlanID)
	}
	if in.CurrentSOC >= in.TargetSOC {
		return nil, fmt.Errorf("current SOC (%d%%) already meets target (%d%%)", in.CurrentSOC, in.TargetSOC)
	}

	batteryCapacity := in.BatteryCapacityKWh
	if batteryCapacity <= 0 {
		batteryCapacity = 75
	}
	maxAmps := in.MaxAmps
	if maxAmps <= 0 {
		maxAmps = 32
	}
	voltage := in.ChargerVoltage
	if voltage <= 0 {
		voltage = 240
	}

	kWhNeeded := float64(in.TargetSOC-in.CurrentSOC) / 100.0 * batteryCapacity
	chargeRateKW := float64(voltage) * float64(maxAmps) / 1000.0
	if chargeRateKW <= 0 {
		return nil, fmt.Errorf("charger power must be positive")
	}
	durationHours := kWhNeeded * 1.10 / chargeRateKW
	durationCeil := int(math.Ceil(durationHours))
	if durationCeil <= 0 {
		durationCeil = 1
	}
	hoursUntilDeadline := WallHoursBetween(in.Now, in.Deadline)
	if float64(durationCeil) > hoursUntilDeadline {
		deadlineLabel := in.DeadlineLabel
		if deadlineLabel == "" {
			deadlineLabel = "deadline"
		}
		return nil, fmt.Errorf(
			"not enough time: need %.1f hours but only %.1f hours until %s",
			durationHours, hoursUntilDeadline, deadlineLabel,
		)
	}

	seasonName := SeasonForDate(plan, in.Deadline)
	rates := BuildHourlyRates(plan.Seasons[seasonName])
	candidates := make([]WindowCandidate, 0, 24)

	for startHour := 0; startHour < 24; startHour++ {
		start := time.Date(in.Deadline.Year(), in.Deadline.Month(), in.Deadline.Day(), startHour, 0, 0, 0, in.Deadline.Location())
		if start.After(in.Deadline) {
			start = start.AddDate(0, 0, -1)
		}
		end := AddWallHours(start, durationCeil)
		if start.Before(in.Now) || end.After(in.Deadline) {
			continue
		}

		cost, avgRate := CostForWindow(rates, startHour, durationCeil, kWhNeeded)
		counts := make(map[string]int)
		tierOrder := make([]string, 0, durationCeil)
		for i := 0; i < durationCeil; i++ {
			hour := (startHour + i) % 24
			tier := rates[hour].Tier
			counts[tier]++
			if counts[tier] == 1 {
				tierOrder = append(tierOrder, tier)
			}
		}
		dominant := "unknown"
		maxCount := -1
		for _, tier := range tierOrder {
			if counts[tier] > maxCount {
				dominant = tier
				maxCount = counts[tier]
			}
		}

		candidates = append(candidates, WindowCandidate{
			StartHour: startHour, StartTime: start, EndTime: end,
			Cost: cost, AvgRateCents: avgRate, Tier: dominant,
		})
	}
	if len(candidates) == 0 {
		deadlineLabel := in.DeadlineLabel
		if deadlineLabel == "" {
			deadlineLabel = "deadline"
		}
		return nil, fmt.Errorf("no valid charging window found before %s", deadlineLabel)
	}

	sort.Slice(candidates, func(i, j int) bool {
		delta := candidates[i].Cost - candidates[j].Cost
		if math.Abs(delta) > 1e-12 {
			return delta < 0
		}
		return candidates[i].StartHour < candidates[j].StartHour
	})

	best := candidates[0]
	for i := range candidates {
		candidates[i].EndTime = AddWallDuration(candidates[i].StartTime, durationHours)
	}
	alternatives := append([]WindowCandidate(nil), candidates[1:]...)
	if len(alternatives) > 3 {
		alternatives = alternatives[:3]
	}
	chargeNowCost, _ := CostForWindow(rates, in.Now.Hour(), durationCeil, kWhNeeded)

	savings := chargeNowCost - best.Cost
	savingsPct := 0.0
	if chargeNowCost > 0 {
		savingsPct = savings / chargeNowCost * 100
	}

	return &WindowResult{
		KWhNeeded: kWhNeeded, DurationHours: durationHours, DurationCeil: durationCeil,
		Best: best, Alternatives: alternatives,
		ChargeNowCost: chargeNowCost, OptimizedCost: best.Cost,
		Savings: savings, SavingsPct: savingsPct, HourlyRates: rates,
	}, nil
}
