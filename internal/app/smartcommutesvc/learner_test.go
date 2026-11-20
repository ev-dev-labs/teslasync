package smartcommutesvc

import (
	"math"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func TestLearnUsesDistinctLocalDaysAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 7, 7, 45, 0, 0, loc)
	origin := smartcommute.Point{Latitude: 47.1, Longitude: -122.1}
	destination := smartcommute.Point{Latitude: 47.2, Longitude: -122.2}
	var observations []smartcommute.DriveObservation
	for week := 1; week <= 7; week++ {
		day := now.AddDate(0, 0, -7*week)
		observations = append(observations, smartcommute.DriveObservation{
			StartedAt: time.Date(day.Year(), day.Month(), day.Day(), 8, week, 0, 0, loc),
			Origin:    origin, Destination: destination,
		})
	}
	// A repeated observation on the same day is not an eighth departure day.
	observations = append(observations, observations[0])
	got := Learn(observations, now, loc)
	if len(got) != 1 {
		t.Fatalf("suggestions = %d, want one", len(got))
	}
	if got[0].Weekday != time.Tuesday || got[0].Evidence.MatchingDays != 7 ||
		got[0].Evidence.WindowStartS != 8*3600+60 ||
		got[0].Evidence.WindowEndS != 8*3600+7*60 ||
		got[0].DepartureS != 8*3600+4*60 {
		t.Fatalf("suggestion = %+v", got[0])
	}
	if got[0].Origin != origin || got[0].Destination != destination {
		t.Fatalf("endpoints = %+v -> %+v", got[0].Origin, got[0].Destination)
	}
}

func TestLearnSuppressesInsufficientOrIncomparableEvidence(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 4, 7, 7, 45, 0, 0, loc)
	origin := smartcommute.Point{Latitude: 47, Longitude: -122}
	dest := smartcommute.Point{Latitude: 48, Longitude: -123}
	observations := make([]smartcommute.DriveObservation, 0, 10)
	for week := 1; week <= 6; week++ {
		observations = append(observations, smartcommute.DriveObservation{
			StartedAt: now.AddDate(0, 0, -7*week).Add(15 * time.Minute),
			Origin:    origin, Destination: dest,
		})
	}
	observations = append(observations,
		observations[0], // duplicate day
		smartcommute.DriveObservation{StartedAt: now.AddDate(0, 0, -49), Origin: origin, Destination: smartcommute.Point{Latitude: 40, Longitude: -123}},
		smartcommute.DriveObservation{StartedAt: now.AddDate(0, 0, -56), Origin: smartcommute.Point{Latitude: math.NaN()}, Destination: dest},
		smartcommute.DriveObservation{StartedAt: now.AddDate(0, 0, -63), Origin: origin, Destination: dest},
	)
	if got := Learn(observations, now, loc); len(got) != 0 {
		t.Fatalf("suggestions = %+v, want none", got)
	}
	if got := Learn(observations, now, nil); len(got) != 0 {
		t.Fatalf("nil timezone yielded %+v", got)
	}
}
