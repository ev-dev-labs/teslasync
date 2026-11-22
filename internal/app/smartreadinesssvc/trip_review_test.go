package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestEvaluateTripPlanReviewMatchesCompletedJourney(t *testing.T) {
	departure := time.Date(2026, 11, 3, 16, 0, 0, 0, time.UTC)
	now := departure.Add(4 * time.Hour)
	actual := 14.5
	baseline := domain.TripReviewBaseline{
		VehicleID: 7, JourneyID: 10, OriginPlaceID: 1, DestinationID: 3, StopPlaceID: 2,
		SavedAt: departure.Add(-time.Hour), DepartureAt: departure, PlannedArrivalPct: 20, PlannedStopS: 1800,
	}
	journey := domain.TripReviewJourney{
		ID: 10, VehicleID: 7, StartedAt: departure.Add(-5 * time.Minute), EndedAt: departure.Add(145 * time.Minute),
		Drives: []domain.TripReviewDrive{
			{OriginPlaceID: 1, DestinationID: 2, StartedAt: departure, EndedAt: departure.Add(40 * time.Minute)},
			{OriginPlaceID: 2, DestinationID: 3, StartedAt: departure.Add(85 * time.Minute), EndedAt: departure.Add(140 * time.Minute), EndChargePct: &actual},
		},
		ChargeSessions: []domain.TripReviewCharge{
			{PlaceID: 2, StartedAt: departure.Add(47 * time.Minute), EndedAt: departure.Add(79 * time.Minute)},
		},
	}
	got := EvaluateTripPlanReview(baseline, journey, now)
	if got == nil || got.ObservedArrivalPct != actual || got.PlannedArrivalPct != 20 ||
		got.ObservedStopS != 2700 || got.ObservedChargeS != 1920 ||
		got.ExtraStopBudgetS != 900 || got.ArrivalShortfallPct != 5.5 {
		t.Fatalf("matched review = %+v", got)
	}

	for _, tt := range []struct {
		name   string
		change func(*domain.TripReviewBaseline, *domain.TripReviewJourney)
	}{
		{"unlinked journey", func(b *domain.TripReviewBaseline, _ *domain.TripReviewJourney) { b.JourneyID++ }},
		{"different vehicle", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) { j.VehicleID++ }},
		{"plan saved after departure", func(b *domain.TripReviewBaseline, _ *domain.TripReviewJourney) { b.SavedAt = departure }},
		{"journey still active", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) { j.EndedAt = time.Time{} }},
		{"arrival not measured", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) { j.Drives[1].EndChargePct = nil }},
		{"stopped somewhere else", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) { j.Drives[1].OriginPlaceID = 5 }},
		{"charge spans next drive", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) {
			j.ChargeSessions[0].EndedAt = j.Drives[1].EndedAt
		}},
		{"ambiguous overlapping charge", func(_ *domain.TripReviewBaseline, j *domain.TripReviewJourney) {
			j.ChargeSessions = append(j.ChargeSessions, j.ChargeSessions[0])
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			base, trip := baseline, journey
			trip.Drives = append([]domain.TripReviewDrive(nil), journey.Drives...)
			trip.ChargeSessions = append([]domain.TripReviewCharge(nil), journey.ChargeSessions...)
			tt.change(&base, &trip)
			if review := EvaluateTripPlanReview(base, trip, now); review != nil {
				t.Fatalf("unexpected review %+v", review)
			}
		})
	}
	if EvaluateTripPlanReview(baseline, journey, journey.EndedAt.Add(tripReviewTTL)) != nil {
		t.Fatal("expired journey review was displayed")
	}

	baseline.StopPlaceID, baseline.PlannedStopS = 0, 0
	journey.Drives = []domain.TripReviewDrive{{
		OriginPlaceID: 1, DestinationID: 3, StartedAt: departure, EndedAt: departure.Add(140 * time.Minute), EndChargePct: &actual,
	}}
	journey.ChargeSessions = nil
	if direct := EvaluateTripPlanReview(baseline, journey, now); direct == nil || direct.ObservedStopS != 0 || direct.ArrivalShortfallPct != 5.5 {
		t.Fatalf("direct trip review = %+v", direct)
	}
}
