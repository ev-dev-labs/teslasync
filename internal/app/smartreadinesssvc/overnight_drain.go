package smartreadinesssvc

import (
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	overnightMinDuration = 6 * time.Hour
	overnightMaxDuration = 10 * time.Hour
	overnightMinNights   = 4
	overnightMaxNights   = 14
	overnightLookback    = 45 * 24 * time.Hour
)

func EvaluateOvernightDrain(night domain.OvernightDrainObservation, history []domain.OvernightDrainObservation, now time.Time) (*domain.OvernightDrainReview, domain.OvernightDrainReason) {
	if !overnightObservationValid(night) || night.EndAt.After(now) || now.Sub(night.EndAt) > 8*time.Hour {
		return nil, domain.OvernightMissingEvidence
	}
	history = slices.Clone(history)
	slices.SortStableFunc(history, func(a, b domain.OvernightDrainObservation) int {
		return b.EndAt.Compare(a.EndAt)
	})
	lastStart := night.StartAt
	duration := night.EndAt.Sub(night.StartAt)
	losses := make([]float64, 0, overnightMaxNights)
	starts := make([]time.Time, 0, overnightMaxNights)
	ends := make([]time.Time, 0, overnightMaxNights)
	for _, sample := range history {
		if !overnightObservationValid(sample) || sample.EndAt.After(lastStart) ||
			sample.StartAt.Before(night.StartAt.Add(-overnightLookback)) ||
			math.Abs(sample.StartBatteryPct-night.StartBatteryPct) > 15 ||
			math.Abs(sample.StartOutsideC-night.StartOutsideC) > 4 || math.Abs(sample.EndOutsideC-night.EndOutsideC) > 4 {
			continue
		}
		sampleDuration := sample.EndAt.Sub(sample.StartAt)
		if sampleDuration < duration*4/5 || sampleDuration > duration*6/5 {
			continue
		}
		loss := (sample.StartBatteryPct - sample.EndBatteryPct) * float64(duration) / float64(sampleDuration)
		losses = append(losses, loss)
		starts, ends = append(starts, sample.StartAt), append(ends, sample.EndAt)
		lastStart = sample.StartAt
		if len(losses) == overnightMaxNights {
			break
		}
	}
	if len(losses) < overnightMinNights {
		return nil, domain.OvernightInsufficientNights
	}
	slices.Sort(losses)
	loss := night.StartBatteryPct - night.EndBatteryPct
	q1, q3 := overnightQuartile(losses, 0.25), overnightQuartile(losses, 0.75)
	if loss < q3+2 || loss < q3*1.5 {
		return nil, domain.OvernightWithinUsualRange
	}
	factors := observedOvernightFactors(night)
	if len(factors) == 0 {
		return nil, domain.OvernightNoObservedFactors
	}
	return &domain.OvernightDrainReview{
		StartAt: night.StartAt.UTC(), EndAt: night.EndAt.UTC(), MeasuredLossPct: loss,
		TypicalLossLowPct: q1, TypicalLossHighPct: q3, ComparableNights: len(losses), Factors: factors,
		BaselineStarts: starts, BaselineEnds: ends,
	}, domain.OvernightAboveUsualRange
}

func overnightObservationValid(night domain.OvernightDrainObservation) bool {
	duration := night.EndAt.Sub(night.StartAt)
	return duration >= overnightMinDuration && duration <= overnightMaxDuration &&
		finiteBetween(night.StartBatteryPct, 0, 100) && finiteBetween(night.EndBatteryPct, 0, night.StartBatteryPct) &&
		finiteBetween(night.StartOutsideC, -45, 60) && finiteBetween(night.EndOutsideC, -45, 60)
}

func overnightQuartile(sorted []float64, percentile float64) float64 {
	return sorted[int(math.Ceil(float64(len(sorted))*percentile))-1]
}

func observedOvernightFactors(night domain.OvernightDrainObservation) []domain.OvernightFactorObservation {
	first := make(map[domain.OvernightFactor]time.Time, 3)
	order := []domain.OvernightFactor{domain.OvernightSentry, domain.OvernightClimate, domain.OvernightWakeRequested}
	for _, event := range night.Factors {
		if !slices.Contains(order, event.Kind) || event.ObservedAt.Before(night.StartAt) || event.ObservedAt.After(night.EndAt) {
			continue
		}
		if previous := first[event.Kind]; previous.IsZero() || event.ObservedAt.Before(previous) {
			first[event.Kind] = event.ObservedAt.UTC()
		}
	}
	result := make([]domain.OvernightFactorObservation, 0, len(first))
	for _, kind := range order {
		if at := first[kind]; !at.IsZero() {
			result = append(result, domain.OvernightFactorObservation{Kind: kind, ObservedAt: at})
		}
	}
	return result
}
