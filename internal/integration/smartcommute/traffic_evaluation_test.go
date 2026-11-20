package smartcommute_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type trafficLiveFixture struct {
	now  time.Time
	gear string
}

func (l *trafficLiveFixture) GetAll(_ context.Context, vehicle int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	if vehicle != 42 || preference != signal.LiveSignalReadDistributed {
		return nil, errors.New("unexpected live eligibility lookup")
	}
	return map[string]*signal.Value{
		"Gear":              {Raw: l.gear, Timestamp: l.now},
		"LocationLatitude":  {Raw: 47.1, Timestamp: l.now},
		"LocationLongitude": {Raw: -122.1, Timestamp: l.now},
	}, nil
}

type trafficSourceFixture func(context.Context, domain.TrafficQuery, func(context.Context) error) (domain.TrafficComparison, error)

func (f trafficSourceFixture) Compare(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
	return f(ctx, query, authorize)
}

func TestTrafficWorkerOnlyPublishesAnEligiblePrivateOccurrence(t *testing.T) {
	tests := []struct {
		name        string
		prepare     string
		altS        int64
		comparisons int64
		expected    int
	}{
		{"material", "", 29 * 60, 1, 1},
		{"immaterial", "", 41 * 60, 1, 0},
		{"quiet", "quiet", 29 * 60, 0, 0},
		{"moving", "moving", 29 * 60, 0, 0},
		{"stale", "stale", 29 * 60, 0, 0},
		{"skip today", "skip", 29 * 60, 0, 0},
		{"pause", "pause", 29 * 60, 0, 0},
		{"signed-in routine not processed in open mode", "open_worker", 29 * 60, 0, 0},
		{"shared routine not processed in signed-in mode", "shared_routine_signed_in_worker", 29 * 60, 0, 0},
		{"shared routine processed in open mode", "shared_routine_open_worker", 29 * 60, 1, 1},
		{"revoked before outbound request", "revoke", 29 * 60, 0, 0},
		{"revoked after first outbound request", "revoke_between_requests", 29 * 60, 1, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			live := &trafficLiveFixture{gear: "P"}
			var calls atomic.Int64
			var duringRequest func() error
			source := trafficSourceFixture(func(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
				if err := authorize(ctx); err != nil {
					return domain.TrafficComparison{}, err
				}
				calls.Add(1)
				if query.DepartureAt.Sub(live.now) != 15*time.Minute || len(query.Trace) != 3 {
					return domain.TrafficComparison{}, errors.New("comparison outside the approved occurrence or trace")
				}
				if duringRequest != nil {
					if err := duringRequest(); err != nil {
						return domain.TrafficComparison{}, err
					}
					if err := authorize(ctx); !errors.Is(err, port.ErrTrafficClaimLost) {
						return domain.TrafficComparison{}, errors.New("second outbound request was not suppressed")
					} else {
						return domain.TrafficComparison{}, err
					}
				}
				return domain.TrafficComparison{
					Usual:       domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: live.now.Add(-time.Minute)},
					Alternative: domain.TrafficEstimate{DurationS: tt.altS, FlowUpdatedAt: live.now.Add(-time.Minute)},
				}, nil
			})
			options := []smartcommutesvc.Option{
				smartcommutesvc.WithTrafficLiveReader(live),
				smartcommutesvc.WithTrafficSharedOpenMode(tt.prepare == "open_worker" || tt.prepare == "shared_routine_open_worker"),
				smartcommutesvc.WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) {
					return tt.prepare == "quiet", nil
				}, nil),
			}
			f := newFixture(t, options...)
			live.now = f.now
			subject := "traffic-worker-owner"
			const root = "/api/v1/smart-commute"
			repo := commutedb.NewRepository(f.db)
			ownerFixture := *f
			if tt.prepare == "shared_routine_signed_in_worker" || tt.prepare == "shared_routine_open_worker" {
				subject = personal.OpenSubject
				ownerFixture.router = f.sharedRouter()
			}
			expectStatus(t, ownerFixture.request(t, http.MethodPut, root, subject, settings(42, true, true, false)), http.StatusNoContent)
			expectStatus(t, ownerFixture.request(t, http.MethodPost, root+"/routines", subject, manualRoutine(42)), http.StatusCreated)
			saved := snapshot(t, ownerFixture.request(t, http.MethodGet, root+"?vehicle_id=42", subject, nil))
			var routine domain.Routine
			for _, row := range saved.Routines {
				if row.Status == domain.RoutineConfirmed {
					routine = row
				}
			}
			grant := domain.TrafficConsent{
				Trace: []domain.Point{routine.Origin, {Latitude: 47.15, Longitude: -122.15}, routine.Destination},
				LeadS: 900, MinSavingsS: 480, CheckAt: f.now, DepartureAt: f.now.Add(15 * time.Minute),
			}
			if err := repo.SaveTrafficConsent(ctx, subject, routine, grant, f.now); err != nil {
				t.Fatal(err)
			}
			route := fmt.Sprintf("%s/routines/%d", root, routine.ID)
			switch tt.prepare {
			case "moving":
				live.gear = "D"
			case "stale":
				live.now = f.now.Add(-3 * time.Minute)
			case "skip":
				expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-skip", "other", map[string]int{"vehicle_id": 42}), http.StatusNotFound)
				expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-skip", subject, map[string]int{"vehicle_id": 42}), http.StatusNoContent)
			case "pause":
				expectStatus(t, f.request(t, http.MethodPut, root, subject, settings(42, true, true, true)), http.StatusNoContent)
			case "revoke":
				expectStatus(t, f.request(t, http.MethodDelete, route+"/traffic-consent?vehicle_id=42", subject, nil), http.StatusNoContent)
			case "revoke_between_requests":
				duringRequest = func() error { return repo.DeleteTrafficConsent(ctx, subject, 42, routine.ID) }
			}
			restarted := smartcommutesvc.New(repo, append(options, smartcommutesvc.WithClock(func() time.Time { return f.now }))...)
			var workers sync.WaitGroup
			for _, service := range []*smartcommutesvc.Service{f.commute, restarted} {
				workers.Go(func() {
					if _, err := service.ProcessTrafficChecks(ctx, 10); err != nil {
						t.Errorf("process due checks: %v", err)
					}
				})
			}
			workers.Wait()
			if calls.Load() != tt.comparisons {
				t.Fatalf("provider calls = %d, want %d", calls.Load(), tt.comparisons)
			}
			rows, err := f.commute.ListTrafficDecisions(ctx, subject, nil, f.now, 10)
			if err != nil || len(rows) != tt.expected {
				t.Fatalf("owner comparison count = %d, want %d; err = %v", len(rows), tt.expected, err)
			}
			if tt.expected == 0 {
				return
			}
			if rows[0].UsualS != 43*60 || rows[0].AlternativeS != 29*60 || rows[0].VehicleID != 42 {
				t.Fatalf("unexpected persisted comparison: %+v", rows[0])
			}
			firstOccurrence := rows[0].OccurrenceID
			if firstOccurrence == "" {
				t.Fatal("eligible comparison is missing its occurrence ID")
			}
			other, err := f.commute.ListTrafficDecisions(ctx, "other", nil, f.now, 10)
			if err != nil || len(other) != 0 {
				t.Fatalf("foreign subject received %d comparisons, err=%v", len(other), err)
			}
			live.gear = "D"
			expired, err := f.commute.ListTrafficDecisions(ctx, subject, nil, f.now, 10)
			if err != nil || len(expired) != 0 {
				t.Fatalf("departed driver received %d comparisons, err=%v", len(expired), err)
			}
			live.gear = "P"
			f.now = f.now.AddDate(0, 0, 7)
			live.now = f.now
			if _, err := f.commute.ProcessTrafficChecks(ctx, 10); err != nil {
				t.Fatal(err)
			}
			following, err := f.commute.ListTrafficDecisions(ctx, subject, nil, f.now, 10)
			if err != nil || len(following) != 1 {
				t.Fatalf("expected the next occurrence, got %d comparisons, err=%v", len(following), err)
			}
			if following[0].RoutineID != routine.ID || following[0].OccurrenceID == firstOccurrence {
				t.Fatalf("the next departure reused the previous occurrence link: %+v", following[0])
			}
		})
	}
}
