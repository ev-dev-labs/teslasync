package smartcommutesvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func TestArrivalDeadlineAdvisesOnlyAnActionableEarlierDeparture(t *testing.T) {
	departure := time.Date(2026, 4, 7, 15, 0, 0, 0, time.UTC)
	now := departure.Add(-15 * time.Minute)
	window := trafficWindow{departureAt: departure, checkAt: now}
	fresh := now.Add(-time.Minute)
	usual := domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: fresh}
	alternative := domain.TrafficEstimate{DurationS: 29 * 60, FlowUpdatedAt: fresh}
	tests := []struct {
		name        string
		deadline    time.Time
		alternative domain.TrafficEstimate
		wantLatest  time.Time
	}{
		{"both routes risk arrival", departure.Add(22 * time.Minute), alternative, departure.Add(-10 * time.Minute)},
		{"alternative already meets deadline", departure.Add(35 * time.Minute), alternative, time.Time{}},
		{"cannot leave in time", departure.Add(12 * time.Minute), alternative, time.Time{}},
		{"no meaningful lateness", departure.Add(28 * time.Minute), alternative, time.Time{}},
		{"no deadline", time.Time{}, alternative, time.Time{}},
		{"alternative evidence stale", departure.Add(22 * time.Minute), domain.TrafficEstimate{
			DurationS: alternative.DurationS, FlowUpdatedAt: now.Add(-5 * time.Minute),
		}, time.Time{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := evaluateArrivalDeadline(window, test.deadline, domain.TrafficComparison{
				Usual: usual, Alternative: test.alternative,
			}, now)
			if ok != !test.wantLatest.IsZero() || !got.latestAt.Equal(test.wantLatest) {
				t.Fatalf("latest departure = %v, eligible = %t; want %v", got.latestAt, ok, test.wantLatest)
			}
			if ok && !got.expiresAt.Equal(fresh.Add(5*time.Minute)) {
				t.Fatalf("advice expires at %v instead of the earlier traffic evidence deadline", got.expiresAt)
			}
		})
	}
}

func TestManualArrivalDeadlineUsesRoutineTimeZone(t *testing.T) {
	routine := domain.Routine{TimeZone: "America/Los_Angeles", DepartureS: 23 * 3600}
	overnight := time.Date(2026, 4, 8, 6, 0, 0, 0, time.UTC)
	expected := time.Date(2026, 4, 8, 7, 45, 0, 0, time.UTC)
	if got := arrivalDeadlineAt(overnight, routine, 45*60); !got.Equal(expected) {
		t.Fatalf("overnight local deadline = %v, want %v", got, expected)
	}
	routine.DepartureS = 90 * 60
	springForward := time.Date(2026, 3, 8, 9, 30, 0, 0, time.UTC)
	if got := arrivalDeadlineAt(springForward, routine, 150*60); !got.IsZero() {
		t.Fatalf("nonexistent wall time should not produce a deadline: %v", got)
	}
}
