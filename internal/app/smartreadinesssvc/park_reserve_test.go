package smartreadinesssvc

import (
	"slices"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestEstimateParkReserveUsesComparableMeasuredDrops(t *testing.T) {
	now := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	returnAt := now.Add(48 * time.Hour)
	live := domain.ParkReserveConditions{
		ObservedAt: now.Add(-time.Minute), BatteryPct: 34, OutsideC: 4, SentryMode: "Off", Parked: true, Unplugged: true,
	}
	samples := []domain.ParkReserveEpisode{
		{StartObservedAt: now.Add(-10 * 24 * time.Hour), StartBatteryPct: 36, EndBatteryPct: 31, StartOutsideC: 2, EndOutsideC: 4, SentryMode: "Off"},
		{StartObservedAt: now.Add(-20 * 24 * time.Hour), StartBatteryPct: 38, EndBatteryPct: 31, StartOutsideC: 3, EndOutsideC: 6, SentryMode: "Off"},
		{StartObservedAt: now.Add(-30 * 24 * time.Hour), StartBatteryPct: 37, EndBatteryPct: 28, StartOutsideC: 4, EndOutsideC: 5, SentryMode: "Off"},
	}
	for i := range samples {
		samples[i].EndObservedAt = samples[i].StartObservedAt.Add(48 * time.Hour)
	}

	got, reason := EstimateParkReserve(slices.Concat(samples, samples[:1]), live, now, returnAt, 28)
	if reason != domain.ParkReserveAtRisk || got == nil || !got.ReserveRisk ||
		got.ReturnLowPct != 24 || got.ReturnHighPct != 30 || got.ComparableEpisodes != 3 || !got.ObservedAt.Equal(live.ObservedAt) {
		t.Fatalf("reserve crossing from three independent episodes: %+v (%s)", got, reason)
	}
	for _, test := range []struct {
		name        string
		change      func(*domain.ParkReserveConditions, []domain.ParkReserveEpisode)
		reservePct  float64
		want        domain.ParkReserveReason
		hasEstimate bool
	}{
		{"buffer alone cannot trigger", nil, 24.9, domain.ParkReserveAbove, true},
		{"already below reserve is not a predicted crossing", nil, 35, domain.ParkReserveAlreadyLow, true},
		{"moving", func(l *domain.ParkReserveConditions, _ []domain.ParkReserveEpisode) { l.Parked = false }, 28, domain.ParkReserveUnknownState, false},
		{"plugged", func(l *domain.ParkReserveConditions, _ []domain.ParkReserveEpisode) { l.Unplugged = false }, 28, domain.ParkReserveUnknownState, false},
		{"stale", func(l *domain.ParkReserveConditions, _ []domain.ParkReserveEpisode) {
			l.ObservedAt = now.Add(-3 * time.Minute)
		}, 28, domain.ParkReserveUnknownState, false},
		{"different Sentry regime", func(_ *domain.ParkReserveConditions, s []domain.ParkReserveEpisode) { s[1].SentryMode = "Armed" }, 28, domain.ParkReserveInsufficient, false},
		{"weather mismatch", func(_ *domain.ParkReserveConditions, s []domain.ParkReserveEpisode) { s[0].EndOutsideC = 24 }, 28, domain.ParkReserveInsufficient, false},
		{"charging or recalibration", func(_ *domain.ParkReserveConditions, s []domain.ParkReserveEpisode) { s[2].EndBatteryPct = 44 }, 28, domain.ParkReserveInsufficient, false},
		{"overlapping source", func(_ *domain.ParkReserveConditions, s []domain.ParkReserveEpisode) {
			s[1].StartObservedAt = s[0].StartObservedAt.Add(-time.Hour)
			s[1].EndObservedAt = s[0].EndObservedAt.Add(-time.Hour)
		}, 28, domain.ParkReserveInsufficient, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state, history := live, slices.Clone(samples)
			if test.change != nil {
				test.change(&state, history)
			}
			estimate, reason := EstimateParkReserve(history, state, now, returnAt, test.reservePct)
			if reason != test.want || (estimate != nil) != test.hasEstimate || (estimate != nil && estimate.ReserveRisk) {
				t.Fatalf("unexpected forecast: %+v (%s)", estimate, reason)
			}
		})
	}
}
