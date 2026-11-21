package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	cabinHistoryLookback = 45 * 24 * time.Hour
	cabinTransitionGap   = 2 * time.Minute
	cabinMaxEpisode      = 35 * time.Minute
	cabinBuffer          = 2 * time.Minute
	cabinMinComparable   = 3
)

type cabinPrepBounds struct {
	low, high time.Duration
	repeated  bool
}

func EstimateCabinPrep(episodes []domain.CabinPrepEpisode, live domain.CabinPrepConditions, departure, now time.Time, loc *time.Location, targetC float64) (*domain.CabinPrepEstimate, domain.CabinPrepReason) {
	if loc == nil || !finiteBetween(targetC, 16, 29) || !now.Before(departure) ||
		departure.In(loc).Hour() < 5 || departure.In(loc).Hour() > 11 {
		return nil, domain.CabinPrepInvalidPlan
	}
	if !live.Parked || live.ObservedAt.IsZero() || live.ObservedAt.After(now) ||
		now.Sub(live.ObservedAt) > cabinTransitionGap || !finiteBetween(live.CabinC, -45, 80) ||
		!finiteBetween(live.OutsideC, -45, 60) {
		return nil, domain.CabinPrepUnknownState
	}
	if live.HVACOn {
		return nil, domain.CabinPrepAlreadyActive
	}
	initialDelta := live.CabinC - targetC
	if math.Abs(initialDelta) < 2 {
		return nil, domain.CabinPrepComfortable
	}
	mornings := make(map[string]cabinPrepBounds)
	for _, row := range episodes {
		day, bounds, ok := comparableCabinMorning(row, live, departure.In(loc), now, loc, targetC, initialDelta)
		if !ok {
			continue
		}
		if _, repeated := mornings[day]; repeated {
			bounds.repeated = true
		}
		mornings[day] = bounds
	}
	count := 0
	low, high := time.Duration(math.MaxInt64), time.Duration(0)
	for _, bounds := range mornings {
		if bounds.repeated {
			continue
		}
		count++
		low, high = min(low, bounds.low), max(high, bounds.high)
	}
	if count < cabinMinComparable {
		return nil, domain.CabinPrepInsufficient
	}
	if high-low > 12*time.Minute {
		return nil, domain.CabinPrepVariable
	}
	return &domain.CabinPrepEstimate{
		ComparableMornings: count,
		LeadLowS:           int(low / time.Second),
		LeadHighS:          int(math.Ceil((high + cabinBuffer).Seconds())),
		TargetC:            targetC,
		ObservedAt:         live.ObservedAt.UTC(),
	}, domain.CabinPrepEligible
}

func comparableCabinMorning(row domain.CabinPrepEpisode, live domain.CabinPrepConditions, departure, now time.Time, loc *time.Location, target, delta float64) (string, cabinPrepBounds, bool) {
	first := row.FirstOnAt.In(loc)
	firstMinute, departureMinute := first.Hour()*60+first.Minute(), departure.Hour()*60+departure.Minute()
	weekend := func(day time.Weekday) bool { return day == time.Saturday || day == time.Sunday }
	if row.LastOffAt.Before(now.Add(-cabinHistoryLookback)) || !row.FirstInBandAt.Before(now) ||
		!row.LastOffAt.Before(row.FirstOnAt) || row.FirstOnAt.Sub(row.LastOffAt) > cabinTransitionGap ||
		row.LastOutOfBandAt.Before(row.FirstOnAt) || !row.LastOutOfBandAt.Before(row.FirstInBandAt) ||
		row.FirstInBandAt.Sub(row.LastOutOfBandAt) > cabinTransitionGap ||
		row.FirstInBandAt.Sub(row.LastOffAt) > cabinMaxEpisode ||
		firstMinute < departureMinute-90 || firstMinute > departureMinute+45 ||
		weekend(first.Weekday()) != weekend(departure.Weekday()) ||
		!finiteBetween(row.InitialCabinC, -45, 80) || !finiteBetween(row.OutsideC, -45, 60) ||
		!finiteBetween(row.TargetC, 16, 29) || math.Abs(row.TargetC-target) > 1 ||
		math.Abs(row.OutsideC-live.OutsideC) > 3 {
		return "", cabinPrepBounds{}, false
	}
	pastDelta := row.InitialCabinC - row.TargetC
	if delta*pastDelta <= 0 || math.Abs(pastDelta) < 2 || math.Abs(pastDelta-delta) > 3 {
		return "", cabinPrepBounds{}, false
	}
	low := row.LastOutOfBandAt.Sub(row.FirstOnAt)
	if low < 2*time.Minute {
		return "", cabinPrepBounds{}, false
	}
	return first.Format(time.DateOnly), cabinPrepBounds{low: low, high: row.FirstInBandAt.Sub(row.LastOffAt)}, true
}
