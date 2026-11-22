package smartcommutesvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func TestTrafficWindowsUseCivilDepartureAndRejectAmbiguousReplay(t *testing.T) {
	const zone = "America/Los_Angeles"
	settings := domain.Settings{Enabled: true, VehicleID: 7, TimeZone: zone}
	for _, tt := range []struct {
		name       string
		now        string
		next       string
		day        time.Weekday
		departureS int
	}{
		{"Tuesday reminder before usual departure", "2026-04-07T14:45:00Z", "2026-04-07T15:00:00Z", time.Tuesday, 8 * 3600},
		{"lead window begins on prior local day", "2026-04-07T06:55:00Z", "2026-04-07T07:05:00Z", time.Tuesday, 5 * 60},
		{"spring-forward gap skips the occurrence", "2026-03-08T09:45:00Z", "2026-03-15T09:30:00Z", time.Sunday, 2*3600 + 30*60},
		{"fall-back chooses first occurrence", "2026-11-01T08:15:00Z", "2026-11-01T08:30:00Z", time.Sunday, 3600 + 30*60},
		{"fall-back cannot replay later occurrence", "2026-11-01T08:31:00Z", "2026-11-08T09:30:00Z", time.Sunday, 3600 + 30*60},
	} {
		t.Run(tt.name, func(t *testing.T) {
			now := instant(t, tt.now)
			routine := domain.Routine{VehicleID: 7, Status: domain.RoutineConfirmed, TimeZone: zone, Weekday: tt.day, DepartureS: tt.departureS}
			window, ok := nextTrafficWindow(settings, routine, 900, now)
			want := instant(t, tt.next)
			if !ok || !window.departureAt.Equal(want) || !window.checkAt.Equal(want.Add(-15*time.Minute)) {
				t.Fatalf("traffic window = %+v (%t), want departure %s", window, ok, want)
			}
		})
	}
}

func TestTrafficOpportunityRequiresMaterialFreshBenefitBeforeDeparture(t *testing.T) {
	now := instant(t, "2026-04-07T14:45:00Z")
	window := trafficWindow{departureAt: now.Add(15 * time.Minute), checkAt: now}
	for _, tt := range []struct {
		name         string
		alternativeS int64
		observedAge  time.Duration
		at           time.Time
		eligible     bool
	}{
		{"43 versus 29 minutes", 29 * 60, time.Minute, now, true},
		{"two minutes is silent", 41 * 60, time.Minute, now, false},
		{"historical timing is silent", 29 * 60, 6 * time.Minute, now, false},
		{"departed is silent", 29 * 60, time.Minute, window.departureAt, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			comparison := domain.TrafficComparison{
				Usual:       domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: now},
				Alternative: domain.TrafficEstimate{DurationS: tt.alternativeS, FlowUpdatedAt: now.Add(-tt.observedAge)},
			}
			expires, ok := trafficOpportunity(window, comparison, 8*60, tt.at)
			if ok != tt.eligible || (ok && !expires.Equal(now.Add(4*time.Minute))) {
				t.Fatalf("traffic decision expiry = %s (%t), want eligible %t", expires, ok, tt.eligible)
			}
		})
	}
}

func instant(t *testing.T, value string) time.Time {
	t.Helper()
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return at
}
