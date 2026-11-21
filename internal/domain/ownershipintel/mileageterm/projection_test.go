package mileageterm

import (
	"math"
	"slices"
	"testing"
	"time"
)

func TestProjectUsesRecordedOpeningOdometerAndActualTerm(t *testing.T) {
	term, samples, through := mileageFixture(t)
	slices.Reverse(samples)
	now := through.Add(34 * time.Hour)
	got, outcome := Project(term, samples, through, now)
	if outcome != OffPace || got == nil {
		t.Fatalf("expected a material overage: %+v %s", got, outcome)
	}
	const used, observedHours, termHours = 116_000.0, 1_391, 13_103
	const remainingHours = termHours - observedHours
	if got.UsedM != used || got.ObservedDays != 9 ||
		got.LowerM != math.Floor(used+used*.8*remainingHours/observedHours) ||
		got.UpperM != math.Ceil(used+used*1.2*remainingHours/observedHours) {
		t.Fatalf("unexpected range or evidence: %+v", got)
	}
	if want := term.AllowanceM * observedHours / termHours; math.Abs(got.AllowedToDateM-want) > .01 {
		t.Fatalf("allowance accrued at the last observation: got %.2f want %.2f", got.AllowedToDateM, want)
	}
}

func TestProjectStaysQuietWhenProjectedOverageIsNotSupported(t *testing.T) {
	for _, tt := range []struct {
		name string
		edit func(*Term, []Observation, *time.Time, *time.Time) []Observation
		want Outcome
	}{
		{"near allowance", func(term *Term, samples []Observation, _, _ *time.Time) []Observation {
			term.AllowanceM = 880_000
			return samples
		}, NotMaterial},
		{"recent pace flat", func(_ *Term, samples []Observation, _, _ *time.Time) []Observation {
			for i := 5; i < len(samples); i++ {
				samples[i].OdometerM = samples[4].OdometerM
			}
			return samples
		}, NotMaterial},
		{"sparse drives", func(_ *Term, samples []Observation, _, _ *time.Time) []Observation {
			return samples[:6]
		}, InsufficientEvidence},
		{"stale evidence", func(_ *Term, samples []Observation, through, now *time.Time) []Observation {
			*through, *now = through.AddDate(0, 0, 8), now.AddDate(0, 0, 8)
			return samples
		}, InsufficientEvidence},
		{"reset odometer", func(_ *Term, samples []Observation, _, _ *time.Time) []Observation {
			samples[2].OdometerM = 300_000
			return samples
		}, ConflictingEvidence},
		{"term ended", func(term *Term, samples []Observation, _, now *time.Time) []Observation {
			*now = term.End
			return samples
		}, NotActionable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			term, samples, through := mileageFixture(t)
			now := through.Add(34 * time.Hour)
			samples = tt.edit(&term, samples, &through, &now)
			if got, outcome := Project(term, samples, through, now); got != nil || outcome != tt.want {
				t.Fatalf("expected quiet %s, got %+v %s", tt.want, got, outcome)
			}
		})
	}
}

func mileageFixture(t *testing.T) (Term, []Observation, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 2, 1, 0, 0, 0, 0, loc)
	term := Term{Start: start, End: start.AddDate(1, 6, 0), OpeningM: 8_000_000, AllowanceM: 700_000, MinimumM: 40_000}
	var observations []Observation
	for day := 18; day <= 58; day += 5 {
		observations = append(observations, Observation{At: start.AddDate(0, 0, day), OdometerM: term.OpeningM + float64(day*2000)})
	}
	through := time.Date(2026, 4, 1, 0, 0, 0, 0, loc)
	return term, observations, through
}
