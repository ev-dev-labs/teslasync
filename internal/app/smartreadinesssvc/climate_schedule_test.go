package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestScheduledClimateNeedsObservedStartAndNoTravelEvidence(t *testing.T) {
	start := time.Date(2026, 11, 9, 7, 0, 0, 0, time.UTC)
	now := start.Add(2 * time.Hour)
	run := domain.ClimateScheduleRun{FiredAt: start, TriggeredAt: start.Add(time.Second), CompletedAt: start.Add(20 * time.Second)}
	at := func(offset time.Duration, on bool, emitted string) signal.TimelineRow {
		when := start.Add(offset)
		return signal.TimelineRow{Timestamp: when, ObservedAt: map[string]time.Time{emitted: when},
			SourceTime: map[string]time.Time{emitted: when},
			Fields: map[string]signal.SignalValue{"HvacPower": on, "Gear": "P", "Odometer": 52000.0,
				"InsideTemp": 12 + offset.Minutes()/20, "CabinOverheatProtectionMode": "Off"}}
	}
	rows := func() []signal.TimelineRow {
		result := []signal.TimelineRow{at(-time.Minute, false, "InsideTemp"), at(time.Minute, true, "HvacPower")}
		offAt := start.Add(-6 * time.Minute)
		result[0].ObservedAt["HvacPower"], result[0].SourceTime["HvacPower"] = offAt, offAt
		for minute := 10; minute <= 80; minute += 10 {
			result = append(result, at(time.Duration(minute)*time.Minute, true, "InsideTemp"))
		}
		return append(result, at(89*time.Minute, true, "InsideTemp"))
	}
	positive := observedClimateScheduleRun(rows(), run, now)
	if positive == nil || !positive.ClimateOn.Equal(start.Add(time.Minute)) || !positive.VerifiedTo.Equal(start.Add(89*time.Minute)) {
		t.Fatalf("complete observed start and no-travel window did not qualify: %+v", positive)
	}
	for _, tt := range []struct {
		name   string
		change func([]signal.TimelineRow)
	}{
		{"already on", func(rows []signal.TimelineRow) { rows[0].Fields["HvacPower"] = true }},
		{"receipt-only initial HVAC off", func(rows []signal.TimelineRow) { delete(rows[0].SourceTime, "HvacPower") }},
		{"forward filled HVAC", func(rows []signal.TimelineRow) { delete(rows[1].ObservedAt, "HvacPower") }},
		{"receipt-only coverage", func(rows []signal.TimelineRow) { delete(rows[3].SourceTime, "InsideTemp") }},
		{"overheat protection", func(rows []signal.TimelineRow) { rows[1].Fields["CabinOverheatProtectionMode"] = "On" }},
		{"telemetry gap after the action", func(rows []signal.TimelineRow) { delete(rows[3].ObservedAt, "InsideTemp") }},
		{"no actual evidence late in the window", func(rows []signal.TimelineRow) { delete(rows[len(rows)-1].ObservedAt, "InsideTemp") }},
		{"travel without a drive row", func(rows []signal.TimelineRow) { rows[2].Fields["Odometer"] = 52020.0 }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			trace := rows()
			tt.change(trace)
			if got := observedClimateScheduleRun(trace, run, now); got != nil {
				t.Fatalf("untrustworthy evidence qualified: %+v", got)
			}
		})
	}
	if got := observedClimateScheduleRun(rows(), run, start.Add(89*time.Minute)); got != nil {
		t.Fatalf("partially observed window qualified: %+v", got)
	}
}

func TestScheduledClimateWeeklyReviewMatchesLocalWeekdayAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	monday := time.Date(2026, 11, 9, 7, 30, 0, 0, loc)
	observed := func(at time.Time) domain.ClimateScheduleObservation {
		return domain.ClimateScheduleObservation{FiredAt: at.UTC(), ClimateOn: at.Add(time.Minute), VerifiedTo: at.Add(89 * time.Minute)}
	}
	source := []domain.ClimateScheduleObservation{
		observed(monday.AddDate(0, 0, -14)),
		observed(monday),
		observed(monday), // A retry or repeated tick on the same local date is not a new morning.
		observed(monday.AddDate(0, 0, -7)),
		observed(monday.AddDate(0, 0, -1)),
		observed(monday.AddDate(0, 0, -21).Add(time.Hour)),
	}
	positive := summarizeClimateSchedule(source, monday.Add(3*time.Hour), loc)
	if positive == nil || len(positive.Observations) != 3 || !positive.Observations[0].FiredAt.Equal(monday) ||
		positive.WeekOf.In(loc).Hour() != 0 || !positive.ExpiresAt.Equal(positive.WeekOf.AddDate(0, 0, 7)) {
		t.Fatalf("three matching local Mondays did not yield one weekly review: %+v", positive)
	}
	if got := summarizeClimateSchedule(source, monday.AddDate(0, 0, 7).Add(3*time.Hour), loc); got != nil {
		t.Fatalf("old evidence was recycled into a later week: %+v", got)
	}
	if got := summarizeClimateSchedule(source[1:], monday.Add(3*time.Hour), loc); got != nil {
		t.Fatalf("a duplicate date, another weekday or another hour was counted: %+v", got)
	}
}
