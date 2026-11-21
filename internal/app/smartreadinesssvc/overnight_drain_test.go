package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestOvernightDrainReviewRequiresExcessAndCoincidentObservation(t *testing.T) {
	morning := time.Date(2026, 11, 20, 6, 0, 0, 0, time.UTC)
	night := domain.OvernightDrainObservation{
		StartAt: morning.Add(-8 * time.Hour), EndAt: morning,
		StartBatteryPct: 60, EndBatteryPct: 53, StartOutsideC: 4, EndOutsideC: 3,
		Factors: []domain.OvernightFactorObservation{
			{Kind: domain.OvernightWakeRequested, ObservedAt: morning.Add(time.Minute)},
			{Kind: domain.OvernightClimate, ObservedAt: morning.Add(-time.Hour)},
			{Kind: domain.OvernightSentry, ObservedAt: morning.Add(-2 * time.Hour)},
			{Kind: domain.OvernightSentry, ObservedAt: morning.Add(-3 * time.Hour)},
		},
	}
	history := make([]domain.OvernightDrainObservation, 4)
	for i, loss := range []float64{2, 1, 3, 2} {
		sample := night
		sample.StartAt, sample.EndAt = night.StartAt.AddDate(0, 0, -i-1), night.EndAt.AddDate(0, 0, -i-1)
		sample.EndBatteryPct = sample.StartBatteryPct - loss
		sample.Factors = nil
		history[i] = sample
	}
	review, reason := EvaluateOvernightDrain(night, history, morning)
	if review == nil || reason != domain.OvernightAboveUsualRange || review.MeasuredLossPct != 7 ||
		review.TypicalLossLowPct != 1 || review.TypicalLossHighPct != 2 || review.ComparableNights != 4 ||
		len(review.Factors) != 2 || review.Factors[0].Kind != domain.OvernightSentry ||
		!review.Factors[0].ObservedAt.Equal(morning.Add(-3*time.Hour)) {
		t.Fatalf("want measured excess with only direct same-window factor observations, got %+v (%s)", review, reason)
	}

	for _, test := range []struct {
		name   string
		change func(*domain.OvernightDrainObservation, []domain.OvernightDrainObservation)
		want   domain.OvernightDrainReason
	}{
		{"ordinary night", func(n *domain.OvernightDrainObservation, _ []domain.OvernightDrainObservation) {
			n.EndBatteryPct = 57
		}, domain.OvernightWithinUsualRange},
		{"no coincident observation", func(n *domain.OvernightDrainObservation, _ []domain.OvernightDrainObservation) {
			n.Factors = n.Factors[:1]
		}, domain.OvernightNoObservedFactors},
		{"different temperature", func(_ *domain.OvernightDrainObservation, h []domain.OvernightDrainObservation) {
			h[1].EndOutsideC = -8
		}, domain.OvernightInsufficientNights},
		{"duplicate is not an independent night", func(_ *domain.OvernightDrainObservation, h []domain.OvernightDrainObservation) {
			h[2] = h[1]
		}, domain.OvernightInsufficientNights},
		{"short fragment", func(n *domain.OvernightDrainObservation, _ []domain.OvernightDrainObservation) {
			n.StartAt = morning.Add(-time.Hour)
		}, domain.OvernightMissingEvidence},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := night
			samples := append([]domain.OvernightDrainObservation(nil), history...)
			test.change(&current, samples)
			if got, reason := EvaluateOvernightDrain(current, samples, morning); got != nil || reason != test.want {
				t.Fatalf("want quiet reason %s, got %+v (%s)", test.want, got, reason)
			}
		})
	}
}

func TestOvernightWindowUsesLocalNightAcrossDST(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		month time.Month
		day   int
		want  time.Duration
	}{{time.March, 8, 7 * time.Hour}, {time.November, 1, 9 * time.Hour}} {
		start, end := overnightWindow(time.Date(2026, test.month, test.day, 8, 0, 0, 0, location))
		if start.Hour() != 22 || end.Hour() != 6 || end.Day() != test.day || end.Sub(start) != test.want {
			t.Errorf("want local 22:00 to 06:00 (%v), got %v to %v", test.want, start, end)
		}
	}
}
