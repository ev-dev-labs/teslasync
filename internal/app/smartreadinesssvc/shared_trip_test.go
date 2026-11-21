package smartreadinesssvc

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestSharedTripServiceComparesOnlyAfterExactParticipantConfirmation(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	repo := &sharedTripTestRepository{}
	live := sharedTripTestSignals(t, now)
	s := NewSharedTripService(repo, live, func(_ context.Context, subject string) bool { return subject == "operator" },
		func() time.Time { return now })
	operator, alex, robin := sharedTripBrowser("operator"), sharedTripBrowser("Alex"), sharedTripBrowser("Robin")
	draft := domain.SharedTripDraft{
		SharedTrip: domain.SharedTrip{DepartureAt: now.Add(time.Hour)},
		Nominations: []domain.SharedTripNomination{
			{VehicleID: 11, Subject: alex.Subject},
			{VehicleID: 22, Subject: robin.Subject},
			{VehicleID: 33, Subject: "Kim"},
		},
	}
	if _, err := s.SaveTrip(ctx, alex, draft); !errors.Is(err, ErrSharedTripOperatorRequired) {
		t.Fatalf("non-operator save error = %v", err)
	}
	trip, err := s.SaveTrip(ctx, operator, draft)
	if err != nil {
		t.Fatal(err)
	}
	confirm := sharedTripTestConfirmation()
	key := domain.SharedTripEntryKey{TripID: trip.ID, Revision: trip.Revision, VehicleID: 11, EntryVersion: 1}
	if err := s.ConfirmVehicle(ctx, robin, key, confirm); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("wrong vehicle owner confirmation error = %v", err)
	}
	incomplete := confirm
	incomplete.ReservePct = nil
	if err := s.ConfirmVehicle(ctx, alex, key, incomplete); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("confirmation without explicit reserve error = %v", err)
	}
	if err := s.ConfirmVehicle(ctx, alex, key, confirm); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfirmVehicle(ctx, alex, key, confirm); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("stale confirmation retry error = %v", err)
	}
	if got, err := s.Comparison(ctx, alex, trip.ID); got != nil || err != nil || len(live.reads) != 0 {
		t.Fatalf("comparison with one accepted entry = %+v, %v; live reads %v", got, err, live.reads)
	}
	robinKey := key
	robinKey.VehicleID = 22
	if err := s.ConfirmVehicle(ctx, robin, robinKey, confirm); err != nil {
		t.Fatal(err)
	}
	for _, denied := range []SharedTripActor{
		operator, sharedTripBrowser("Kim"), sharedTripBrowser("alex"), sharedTripBrowser(personal.OpenSubject),
		{Subject: alex.Subject}, {Subject: alex.Subject, VerifiedBrowser: true, Impersonating: true},
	} {
		if got, err := s.Comparison(ctx, denied, trip.ID); got != nil || !errors.Is(err, port.ErrNotFound) || len(live.reads) != 0 {
			t.Fatalf("unauthorized comparison = %+v, %v; live reads %v", got, err, live.reads)
		}
	}

	live.values[22].Timestamp = now.Add(5 * time.Second)
	now = now.Add(10 * time.Second)
	got, err := s.Comparison(ctx, alex, trip.ID)
	if got == nil || err != nil {
		t.Fatalf("authorized comparison = %+v, %v", got, err)
	}
	want := []domain.SharedTripVehicleOption{
		{VehicleID: 11, ReturnLowPct: 52, ReturnHighPct: 62, ReservePct: 20,
			ObservedAt: now.Add(-70 * time.Second), ExpiresAt: now.Add(50 * time.Second)},
		{VehicleID: 22, ReturnLowPct: 45, ReturnHighPct: 55, ReservePct: 20,
			ObservedAt: now.Add(-5 * time.Second), ExpiresAt: now.Add(115 * time.Second)},
	}
	if !slices.Equal(got.Options, want) || !got.ExpiresAt.Equal(want[0].ExpiresAt) || !slices.Equal(live.reads, []int64{11, 22}) {
		t.Fatalf("comparison = %+v, live reads = %v", got, live.reads)
	}

	robinKey.EntryVersion++
	if err := s.WithdrawVehicle(ctx, robin, robinKey); err != nil {
		t.Fatal(err)
	}
	if got, err := s.Comparison(ctx, robin, trip.ID); got != nil || !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("withdrawn participant comparison = %+v, %v", got, err)
	}
	draft.SharedTrip = *trip
	draft.DepartureAt = draft.DepartureAt.Add(time.Hour)
	revised, err := s.SaveTrip(ctx, operator, draft)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.Comparison(ctx, alex, revised.ID); got != nil || !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("revised trip reused confirmation: %+v, %v", got, err)
	}
	key.EntryVersion++
	if err := s.ConfirmVehicle(ctx, alex, key, confirm); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("superseded trip confirmation error = %v", err)
	}
}

func TestSharedTripServiceSuppressesInsufficientOrSupersededEvidence(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	actor := sharedTripBrowser("Alex")
	tests := []struct {
		name        string
		setup       func(*sharedTripTestRepository, *sharedTripSignalStub)
		wantReads   []int64
		wantMissing bool
	}{
		{"audience expired", func(r *sharedTripTestRepository, _ *sharedTripSignalStub) {
			r.entries[0].confirmation.ExpiresAt = now
		}, nil, true},
		{"candidate expired", func(r *sharedTripTestRepository, _ *sharedTripSignalStub) {
			r.entries[1].confirmation.ExpiresAt = now
		}, nil, false},
		{"schedule conflict", func(r *sharedTripTestRepository, _ *sharedTripSignalStub) {
			r.entries[1].confirmation.ScheduleClear = false
		}, nil, false},
		{"overdue service", func(r *sharedTripTestRepository, _ *sharedTripSignalStub) {
			r.entries[1].confirmation.MaintenanceClear = false
		}, nil, false},
		{"duplicate evidence", func(r *sharedTripTestRepository, _ *sharedTripSignalStub) {
			r.entries = append(r.entries, r.entries[1])
		}, nil, false},
		{"stale live state", func(_ *sharedTripTestRepository, l *sharedTripSignalStub) {
			l.values[22].Timestamp = now.Add(-signal.LiveSignalFreshnessThreshold)
		}, []int64{11, 22}, false},
		{"synthetic timestamp", func(_ *sharedTripTestRepository, l *sharedTripSignalStub) {
			l.values[22].TimestampSynthetic = true
		}, []int64{11, 22}, false},
		{"absent live state", func(_ *sharedTripTestRepository, l *sharedTripSignalStub) {
			delete(l.values, 22)
		}, []int64{11, 22}, false},
		{"viewer revokes during evidence collection", func(r *sharedTripTestRepository, l *sharedTripSignalStub) {
			l.afterRead = func(id int64) {
				if id == 22 {
					r.entries[0].confirmation = nil
				}
			}
		}, []int64{11, 22}, true},
		{"entry superseded during evidence collection", func(r *sharedTripTestRepository, l *sharedTripSignalStub) {
			l.afterRead = func(id int64) {
				if id == 22 {
					r.entries[1].version++
				}
			}
		}, []int64{11, 22}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			confirmation := func() *domain.SharedTripConfirmation {
				return &domain.SharedTripConfirmation{TripUseLowPct: 20, TripUseHighPct: 30, ReservePct: 20,
					ScheduleClear: true, MaintenanceClear: true, ConfirmedAt: now.Add(-5 * time.Second), ExpiresAt: now.Add(time.Hour)}
			}
			repo := &sharedTripTestRepository{
				trip: domain.SharedTrip{ID: 1, Revision: 1, DepartureAt: now.Add(time.Hour)},
				entries: []sharedTripTestEntry{
					{domain.SharedTripNomination{VehicleID: 11, Subject: "Alex"}, 2, confirmation()},
					{domain.SharedTripNomination{VehicleID: 22, Subject: "Robin"}, 2, confirmation()},
				},
			}
			live := sharedTripTestSignals(t, now)
			tt.setup(repo, live)
			s := NewSharedTripService(repo, live, nil, func() time.Time { return now })
			got, err := s.Comparison(context.Background(), actor, repo.trip.ID)
			if got != nil || (tt.wantMissing && !errors.Is(err, port.ErrNotFound)) || (!tt.wantMissing && err != nil) ||
				!slices.Equal(live.reads, tt.wantReads) {
				t.Fatalf("comparison = %+v, %v; live reads %v, want %v", got, err, live.reads, tt.wantReads)
			}
		})
	}
}

func sharedTripBrowser(subject string) SharedTripActor {
	return SharedTripActor{Subject: subject, VerifiedBrowser: true}
}

func sharedTripTestConfirmation() domain.SharedTripConfirmationInput {
	low, high, reserve, clear := 20.0, 30.0, 20.0, true
	return domain.SharedTripConfirmationInput{
		TripUseLowPct: &low, TripUseHighPct: &high, ReservePct: &reserve, ScheduleClear: &clear, MaintenanceClear: &clear,
	}
}

type sharedTripSignalStub struct {
	t         *testing.T
	values    map[int64]*signal.Value
	reads     []int64
	afterRead func(int64)
}

func sharedTripTestSignals(t *testing.T, now time.Time) *sharedTripSignalStub {
	return &sharedTripSignalStub{t: t, values: map[int64]*signal.Value{
		11: {Raw: 82.0, Timestamp: now.Add(-time.Minute)},
		22: {Raw: 75.0, Timestamp: now.Add(-30 * time.Second)},
	}}
}

func (l *sharedTripSignalStub) GetSignal(_ context.Context, id int64, name string, preference signal.LiveSignalReadPreference) (*signal.Value, error) {
	l.t.Helper()
	if name != "BatteryLevel" || preference != signal.LiveSignalReadLocal {
		l.t.Fatalf("unexpected live evidence request: %s (%v)", name, preference)
	}
	l.reads = append(l.reads, id)
	if l.afterRead != nil {
		l.afterRead(id)
	}
	return l.values[id], nil
}

type sharedTripTestEntry struct {
	domain.SharedTripNomination
	version      int64
	confirmation *domain.SharedTripConfirmation
}

type sharedTripTestRepository struct {
	port.SharedTripRepository
	trip    domain.SharedTrip
	owner   string
	entries []sharedTripTestEntry
}

func (r *sharedTripTestRepository) SaveSharedTrip(
	_ context.Context, subject string, draft domain.SharedTripDraft, _ time.Time,
) (*domain.SharedTrip, error) {
	if draft.ID != 0 && (draft.ID != r.trip.ID || draft.Revision != r.trip.Revision || subject != r.owner) {
		return nil, port.ErrNotFound
	}
	r.trip = domain.SharedTrip{ID: 1, Revision: r.trip.Revision + 1, DepartureAt: draft.DepartureAt}
	r.owner = subject
	r.entries = nil
	for _, entry := range draft.Nominations {
		r.entries = append(r.entries, sharedTripTestEntry{SharedTripNomination: entry, version: 1})
	}
	result := r.trip
	return &result, nil
}

func (r *sharedTripTestRepository) ConfirmSharedTripVehicle(
	_ context.Context, subject string, key domain.SharedTripEntryKey, confirmation domain.SharedTripConfirmation,
) error {
	entry := r.lookup(subject, key)
	if entry == nil {
		return port.ErrNotFound
	}
	confirmation.ExpiresAt = minTime(confirmation.ExpiresAt, r.trip.DepartureAt)
	entry.confirmation = &confirmation
	entry.version++
	return nil
}

func (r *sharedTripTestRepository) WithdrawSharedTripVehicle(
	_ context.Context, subject string, key domain.SharedTripEntryKey, _ time.Time,
) error {
	entry := r.lookup(subject, key)
	if entry == nil {
		return port.ErrNotFound
	}
	entry.confirmation = nil
	entry.version++
	return nil
}

func (r *sharedTripTestRepository) lookup(subject string, key domain.SharedTripEntryKey) *sharedTripTestEntry {
	if key.TripID == r.trip.ID && key.Revision == r.trip.Revision {
		for i := range r.entries {
			entry := &r.entries[i]
			if entry.VehicleID == key.VehicleID && entry.Subject == subject && entry.version == key.EntryVersion {
				return entry
			}
		}
	}
	return nil
}

func (r *sharedTripTestRepository) ReadSharedTripComparison(
	_ context.Context, subject string, tripID int64, now time.Time,
) (*port.SharedTripComparisonScope, error) {
	if r.trip.ID != tripID || !now.Before(r.trip.DepartureAt) {
		return nil, port.ErrNotFound
	}
	scope := &port.SharedTripComparisonScope{Trip: r.trip}
	for _, entry := range r.entries {
		confirmation := entry.confirmation
		if confirmation == nil || !now.Before(confirmation.ExpiresAt) {
			continue
		}
		if entry.Subject == subject && scope.AccessExpiresAt.Before(confirmation.ExpiresAt) {
			scope.AccessExpiresAt = confirmation.ExpiresAt
		}
		scope.Confirmed = append(scope.Confirmed, domain.SharedTripConfirmedVehicle{
			VehicleID: entry.VehicleID, EntryVersion: entry.version, SharedTripConfirmation: *confirmation,
		})
	}
	if scope.AccessExpiresAt.IsZero() {
		return nil, port.ErrNotFound
	}
	return scope, nil
}
