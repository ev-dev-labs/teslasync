package smartcommutesvc

import (
	"context"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestTrafficOutageSuppressesEarlierDepartureFallbackWithoutInferringOutageFromSleep(t *testing.T) {
	now := time.Date(2026, 4, 7, 14, 45, 0, 0, time.UTC)
	deadline := 15*3600 + 22*60
	origin := domain.Point{Latitude: 47, Longitude: -122}
	for _, tt := range []struct {
		name        string
		live        outageTrafficLive
		wantCalls   int
		wantOutcome string
	}{
		{name: "sleep leaves live state unknown", wantOutcome: "not_at_origin"},
		{name: "second comparison confirms an upstream outage", live: outageTrafficLive{
			"Gear":              {Raw: enums.GearPark, Timestamp: now},
			"LocationLatitude":  {Raw: origin.Latitude, Timestamp: now},
			"LocationLongitude": {Raw: origin.Longitude, Timestamp: now},
		}, wantCalls: 2, wantOutcome: "upstream_paused"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			repo := &outageTrafficRepository{}
			source := &outageTrafficSource{observedAt: now.Add(-time.Minute)}
			var outcome string
			s := New(repo, WithClock(func() time.Time { return now }), WithTrafficLiveReader(tt.live),
				WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) {
					return false, nil
				}, func(reason string) { outcome = reason }))
			err := s.processTrafficCheck(t.Context(), port.TrafficCheck{
				Subject: "synthetic-commuter",
				Routine: domain.Routine{ID: 1, VehicleID: 1, Origin: origin, TimeZone: "UTC", DepartureS: 15 * 3600},
				Consent: domain.TrafficConsent{
					DepartureAt: now.Add(15 * time.Minute), CheckAt: now, ArrivalDeadlineS: &deadline, MinSavingsS: 60,
				},
			})
			if err != nil || repo.published || source.calls != tt.wantCalls || outcome != tt.wantOutcome {
				t.Fatalf("check = %v, published = %t, calls = %d, outcome = %q", err, repo.published, source.calls, outcome)
			}
		})
	}
}

type outageTrafficLive map[string]*signal.Value

func (l outageTrafficLive) GetAll(context.Context, int64, signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	return l, nil
}

type outageTrafficRepository struct {
	port.Repository
	published bool
}

func (r *outageTrafficRepository) VerifyTrafficCheck(_ context.Context, check port.TrafficCheck, _ time.Time) (port.TrafficCheckAccess, error) {
	return port.TrafficCheckAccess{Advice: !check.AdvicePaused, Energy: check.Consent.CompareRouteEnergy}, nil
}

func (r *outageTrafficRepository) RecordTrafficDecision(context.Context, port.TrafficCheck, domain.TrafficDecision, time.Time) (bool, error) {
	r.published = true
	return true, nil
}

type outageTrafficSource struct {
	calls      int
	observedAt time.Time
}

func (s *outageTrafficSource) Compare(ctx context.Context, _ domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
	if err := authorize(ctx); err != nil {
		return domain.TrafficComparison{}, err
	}
	s.calls++
	if s.calls > 1 {
		return domain.TrafficComparison{}, port.ErrEstimatesPaused
	}
	return domain.TrafficComparison{
		Usual:                 domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: s.observedAt},
		Alternative:           domain.TrafficEstimate{DurationS: 29 * 60, FlowUpdatedAt: s.observedAt},
		AlternativesQualified: true,
	}, nil
}
