package smartreadinesssvc

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

func TestSharedChargerS18PublishesOnePrivateReminder(t *testing.T) {
	ctx := t.Context()
	s, repo, now, spec := newSharedChargerS18Harness()
	ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	a, b := sharedChargerS18Inputs(*now)
	invite, err := s.Invitation(ctx, "Bob", ref, 22)
	if err != nil || invite == nil || !invite.ReminderOffered || invite.Confirmed {
		t.Fatalf("chosen invitation = %+v, %v", invite, err)
	}
	if err := s.Confirm(ctx, "Alice", ref, 11, a); err != nil {
		t.Fatal(err)
	}
	if err := s.Confirm(ctx, "Alice", ref, 11, a); !errors.Is(err, port.ErrSharedChargerAlreadyConfirmed) {
		t.Fatalf("duplicate confirmation = %v", err)
	}
	requireSharedChargerS18Silence(t, ctx, s, "Alice", ref)
	if err := s.Confirm(ctx, "Bob", ref, 22, b); err != nil {
		t.Fatal(err)
	}
	card, err := s.Card(ctx, "Alice", ref)
	if err != nil || card == nil {
		t.Fatalf("accepted plan card = %+v, %v", card, err)
	}
	if card.Schedule.First.VehicleID != 11 || card.Schedule.Second.VehicleID != 22 ||
		!card.Schedule.SwapAt.Equal(now.Add(time.Hour)) || !card.Schedule.Second.StartsAt.Equal(now.Add(70*time.Minute)) {
		t.Fatalf("schedule = %+v", card.Schedule)
	}
	if secondView, err := s.Card(ctx, "Bob", ref); err != nil || secondView == nil || *secondView != *card {
		t.Fatalf("other accepted participant card = %+v, %v", secondView, err)
	}
	for _, outsider := range []string{"alice", "operator", "stranger"} {
		requireSharedChargerS18Silence(t, ctx, s, outsider, ref)
	}
	if count, err := s.PublishDueReminders(ctx, 10); count != 0 || err != nil {
		t.Fatalf("early publication = %d, %v", count, err)
	}
	*now = card.Schedule.SwapAt
	var workers sync.WaitGroup
	counts := make(chan int, 8)
	for range cap(counts) {
		workers.Go(func() {
			count, err := s.PublishDueReminders(ctx, 10)
			if err != nil {
				t.Error(err)
			}
			counts <- count
		})
	}
	workers.Wait()
	close(counts)
	published := 0
	for count := range counts {
		published += count
	}
	if published != 1 || !repo.published {
		t.Fatalf("published %d occurrences, want 1", published)
	}
	if reminder, err := s.Reminder(ctx, "Bob", ref); err != nil || reminder == nil || reminder.VehicleID != 22 ||
		!reminder.SwapAt.Equal(card.Schedule.SwapAt) || !reminder.ExpiresAt.Equal(card.Schedule.Second.StartsAt) {
		t.Fatalf("private reminder for Bob = %+v, %v", reminder, err)
	}
	if reminder, err := s.Reminder(ctx, "Alice", ref); err != nil || reminder != nil {
		t.Fatalf("unselected participant reminder = %+v, %v", reminder, err)
	}
	if _, err := s.Authorize(ctx, "operator", ref, spec); !errors.Is(err, port.ErrSharedChargerSwapPublished) {
		t.Fatalf("reauthorize after publication = %v", err)
	}
	*now = card.Schedule.Second.StartsAt
	requireSharedChargerS18Silence(t, ctx, s, "Bob", ref)
}

func TestSharedChargerS18RequiresExactAuthorityAndRevision(t *testing.T) {
	ctx := t.Context()
	s, repo, now, spec := newSharedChargerS18Harness()
	for _, subject := range []string{"Alice", "Operator", personal.OpenSubject} {
		if _, err := s.Authorize(ctx, subject, domain.SharedChargerRef{}, spec); !errors.Is(err, ErrSharedChargerOperatorRequired) {
			t.Errorf("unauthorized proposal by %q = %v", subject, err)
		}
	}
	if repo.ref.ID != 0 {
		t.Fatal("unauthorized proposal reached storage")
	}
	stale := spec
	stale.PlaceUpdatedAt = stale.PlaceUpdatedAt.Add(time.Nanosecond)
	if _, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, stale); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("sub-microsecond mismatch in exact charger revision = %v", err)
	}
	spec.Participants[1].Subject = "Alice"
	ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	a, b := sharedChargerS18Inputs(*now)
	if err := s.Confirm(ctx, "alice", ref, 11, a); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("case-folded confirmation = %v", err)
	}
	if err := s.Confirm(ctx, "operator", ref, 11, a); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("operator confirmation for another subject = %v", err)
	}
	if err := s.Confirm(ctx, "Alice", ref, 11, a); err != nil {
		t.Fatal(err)
	}
	requireSharedChargerS18Silence(t, ctx, s, "Alice", ref)

	next, err := s.Authorize(ctx, "operator", ref, spec)
	if err != nil || next.ID != ref.ID || next.Revision != ref.Revision+1 {
		t.Fatalf("change review = %+v, %v", next, err)
	}
	if err := s.Confirm(ctx, "Alice", ref, 22, b); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("old revision accepts new confirmation: %v", err)
	}
	if err := s.Confirm(ctx, "Alice", next, 22, b); err != nil {
		t.Fatal(err)
	}
	requireSharedChargerS18Silence(t, ctx, s, "Alice", next)
	if err := s.Confirm(ctx, "Alice", next, 11, a); err != nil {
		t.Fatal(err)
	}
	if card, err := s.Card(ctx, "Alice", next); err != nil || card == nil {
		t.Fatalf("two explicit confirmations by same subject = %+v, %v", card, err)
	}
}

func TestSharedChargerS18ListsOnlyOwnerAndExactInvitations(t *testing.T) {
	ctx := t.Context()
	s, _, now, spec := newSharedChargerS18Harness()
	ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	_, evidence := sharedChargerS18Inputs(*now)
	if err := s.Confirm(ctx, "Bob", ref, 22, evidence); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		subject            string
		canManage          bool
		owned, invitations int
	}{
		{"operator", true, 1, 0},
		{"Bob", false, 0, 1},
		{"bob", false, 0, 0},
	} {
		result, err := s.ListPlanning(ctx, tc.subject, 32, 0)
		if err != nil || result.CanManage != tc.canManage || len(result.Owned) != tc.owned || len(result.Invitations) != tc.invitations {
			t.Fatalf("list for %q = %+v, %v", tc.subject, result, err)
		}
		if tc.invitations != 0 {
			invite := result.Invitations[0]
			if invite.Ref != ref || invite.VehicleID != 22 || !invite.Confirmed || !invite.ReminderOffered {
				t.Fatalf("private invitation = %+v", invite)
			}
		}
	}
	if _, err := s.ListPlanning(ctx, "Bob", 51, 0); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized page = %v", err)
	}
	if err := s.Withdraw(ctx, "Bob", ref, 22); err != nil {
		t.Fatal(err)
	}
	if result, err := s.ListPlanning(ctx, "Alice", 32, 0); err != nil || len(result.Invitations) != 0 {
		t.Fatalf("revoked invitation still listed: %+v, %v", result, err)
	}
}

func TestSharedChargerS18Silence(t *testing.T) {
	t.Run("revoked", func(t *testing.T) {
		ctx := t.Context()
		s, _, now, ref := confirmedSharedChargerS18(t)
		if err := s.Withdraw(ctx, "Bob", ref, 11); !errors.Is(err, port.ErrNotFound) {
			t.Fatalf("withdraw not own vehicle = %v", err)
		}
		if err := s.Withdraw(ctx, "Bob", ref, 22); err != nil {
			t.Fatal(err)
		}
		*now = now.Add(time.Hour)
		requireSharedChargerS18Silence(t, ctx, s, "Alice", ref)
		if count, err := s.PublishDueReminders(ctx, 10); count != 0 || err != nil {
			t.Fatalf("publication after withdrawal = %d, %v", count, err)
		}
	})
	t.Run("place revision changed", func(t *testing.T) {
		ctx := t.Context()
		s, repo, now, ref := confirmedSharedChargerS18(t)
		repo.placeRevision = repo.placeRevision.Add(time.Microsecond)
		*now = now.Add(time.Hour)
		requireSharedChargerS18Silence(t, ctx, s, "Bob", ref)
		if count, err := s.PublishDueReminders(ctx, 10); count != 0 || err != nil {
			t.Fatalf("publication with stale charger revision = %d, %v", count, err)
		}
	})
	t.Run("chosen participant did not opt in", func(t *testing.T) {
		ctx := t.Context()
		s, _, now, spec := newSharedChargerS18Harness()
		ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
		if err != nil {
			t.Fatal(err)
		}
		a, b := sharedChargerS18Inputs(*now)
		b.AcceptReminder = false
		if err := s.Confirm(ctx, "Alice", ref, 11, a); err != nil {
			t.Fatal(err)
		}
		if err := s.Confirm(ctx, "Bob", ref, 22, b); err != nil {
			t.Fatal(err)
		}
		*now = now.Add(time.Hour)
		if card, err := s.Card(ctx, "Bob", ref); err != nil || card == nil {
			t.Fatalf("no opt-in should suppress the reminder, not the card: %+v, %v", card, err)
		}
		if count, err := s.PublishDueReminders(ctx, 10); count != 0 || err != nil {
			t.Fatalf("publication without recipient opt-in = %d, %v", count, err)
		}
	})
}

func TestSharedChargerS18RejectsIncompleteEvidence(t *testing.T) {
	ctx := t.Context()
	s, _, now, spec := newSharedChargerS18Harness()
	ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	_, valid := sharedChargerS18Inputs(*now)
	for _, test := range []struct {
		name   string
		change func(*SharedChargerConfirmationInput)
	}{
		{"missing occupancy", func(input *SharedChargerConfirmationInput) { input.AlreadyPlugged = nil }},
		{"nonfinite energy", func(input *SharedChargerConfirmationInput) { input.EnergyNeededWh = math.NaN() }},
		{"nonfinite power", func(input *SharedChargerConfirmationInput) { input.ConservativePowerW = math.Inf(1) }},
		{"reversed window", func(input *SharedChargerConfirmationInput) { input.AvailableAt = input.DepartureAt }},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			test.change(&input)
			if err := s.Confirm(ctx, "Bob", ref, 22, input); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("confirmation = %v, want invalid input", err)
			}
		})
	}
}

func requireSharedChargerS18Silence(t *testing.T, ctx context.Context, s *SharedChargerService, subject string, ref domain.SharedChargerRef) {
	t.Helper()
	if card, err := s.Card(ctx, subject, ref); card != nil || err != nil {
		t.Errorf("unexpected card for %s: %+v, %v", subject, card, err)
	}
	if reminder, err := s.Reminder(ctx, subject, ref); reminder != nil || err != nil {
		t.Errorf("unexpected reminder for %s: %+v, %v", subject, reminder, err)
	}
}

func confirmedSharedChargerS18(t *testing.T) (*SharedChargerService, *sharedChargerS18MemoryRepo, *time.Time, domain.SharedChargerRef) {
	t.Helper()
	ctx := t.Context()
	s, repo, now, spec := newSharedChargerS18Harness()
	ref, err := s.Authorize(ctx, "operator", domain.SharedChargerRef{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	a, b := sharedChargerS18Inputs(*now)
	if err := s.Confirm(ctx, "Alice", ref, 11, a); err != nil {
		t.Fatal(err)
	}
	if err := s.Confirm(ctx, "Bob", ref, 22, b); err != nil {
		t.Fatal(err)
	}
	return s, repo, now, ref
}

func newSharedChargerS18Harness() (*SharedChargerService, *sharedChargerS18MemoryRepo, *time.Time, domain.SharedChargerAuthorization) {
	now := time.Date(2026, 11, 21, 4, 0, 0, 0, time.UTC)
	spec := domain.SharedChargerAuthorization{
		PlaceID: 8, PlaceUpdatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(5 * time.Hour),
		Participants:      [2]domain.SharedChargerParticipant{{VehicleID: 11, Subject: "Alice"}, {VehicleID: 22, Subject: "Bob"}},
		ReminderVehicleID: 22,
	}
	repo := &sharedChargerS18MemoryRepo{placeRevision: spec.PlaceUpdatedAt}
	return NewSharedChargerService(repo, func(_ context.Context, subject string) (bool, error) {
		return subject == "operator", nil
	}, func() time.Time { return now }), repo, &now, spec
}

func sharedChargerS18Inputs(now time.Time) (SharedChargerConfirmationInput, SharedChargerConfirmationInput) {
	plugged, unplugged := true, false
	a := SharedChargerConfirmationInput{
		AvailableAt: now, DepartureAt: now.Add(3 * time.Hour), EnergyNeededWh: 3600, ConservativePowerW: 3600,
		AlreadyPlugged: &plugged,
	}
	b := a
	b.DepartureAt, b.AlreadyPlugged, b.AcceptReminder = now.Add(2*time.Hour+10*time.Minute), &unplugged, true
	return a, b
}

// This models the port contract for application tests; it is not PostgreSQL
// evidence. Only publishing is called concurrently by the tests.
type sharedChargerS18MemoryRepo struct {
	mu            sync.Mutex
	ref           domain.SharedChargerRef
	spec          domain.SharedChargerAuthorization
	confirmation  [2]domain.SharedChargerConfirmation
	placeRevision time.Time
	revoked       bool
	pending       *domain.SharedChargerReminder
	published     bool
}

func (r *sharedChargerS18MemoryRepo) active(ref domain.SharedChargerRef, now time.Time) bool {
	return ref == r.ref && !r.revoked && now.Before(r.spec.ExpiresAt) && r.placeRevision.Equal(r.spec.PlaceUpdatedAt)
}

func (r *sharedChargerS18MemoryRepo) member(subject string, vehicleID int64) int {
	for i, participant := range r.spec.Participants {
		if participant.Subject == subject && (vehicleID == 0 || participant.VehicleID == vehicleID) {
			return i
		}
	}
	return -1
}

func (r *sharedChargerS18MemoryRepo) AuthorizeSharedCharger(_ context.Context, _ string, ref domain.SharedChargerRef,
	spec domain.SharedChargerAuthorization, now time.Time,
) (domain.SharedChargerRef, error) {
	if !spec.PlaceUpdatedAt.Equal(r.placeRevision) || (ref.ID != 0 && !r.active(ref, now)) {
		return domain.SharedChargerRef{}, port.ErrNotFound
	}
	if r.published {
		return domain.SharedChargerRef{}, port.ErrSharedChargerSwapPublished
	}
	r.ref = domain.SharedChargerRef{ID: 9, Revision: r.ref.Revision + 1}
	r.spec = spec
	r.confirmation = [2]domain.SharedChargerConfirmation{}
	r.pending = nil
	return r.ref, nil
}

func (r *sharedChargerS18MemoryRepo) FindSharedChargerInvitation(_ context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64, now time.Time,
) (*domain.SharedChargerInvitation, error) {
	pos := r.member(subject, vehicleID)
	if pos < 0 || !r.active(ref, now) {
		return nil, nil
	}
	return &domain.SharedChargerInvitation{
		Ref: ref, VehicleID: vehicleID, PlaceID: r.spec.PlaceID, PlaceUpdatedAt: r.spec.PlaceUpdatedAt, ExpiresAt: r.spec.ExpiresAt,
		ReminderOffered: r.spec.ReminderVehicleID == vehicleID, Confirmed: !r.confirmation[pos].ConfirmedAt.IsZero(),
	}, nil
}

func (r *sharedChargerS18MemoryRepo) ListSharedChargerPlanning(ctx context.Context, subject string, includeOwned bool,
	now time.Time, _, _ int,
) (port.SharedChargerPlanning, error) {
	result := port.SharedChargerPlanning{CanManage: includeOwned}
	if includeOwned && r.active(r.ref, now) && r.ref.ID > 0 && subject == "operator" {
		result.Owned = append(result.Owned, port.SharedChargerOwnedPlan{
			Ref: r.ref, PlaceID: r.spec.PlaceID, ExpiresAt: r.spec.ExpiresAt,
		})
	}
	for _, p := range r.spec.Participants {
		if invite, err := r.FindSharedChargerInvitation(ctx, subject, r.ref, p.VehicleID, now); err == nil && invite != nil {
			result.Invitations = append(result.Invitations, *invite)
		}
	}
	return result, nil
}

func (r *sharedChargerS18MemoryRepo) ConfirmSharedCharger(ctx context.Context, subject string, ref domain.SharedChargerRef,
	confirmation domain.SharedChargerConfirmation,
) error {
	vehicleID, now := confirmation.Request.VehicleID, confirmation.ConfirmedAt
	pos := r.member(subject, vehicleID)
	if pos < 0 || !r.active(ref, now) || (confirmation.AcceptReminder && r.spec.ReminderVehicleID != vehicleID) {
		return port.ErrNotFound
	}
	if !r.confirmation[pos].ConfirmedAt.IsZero() {
		return port.ErrSharedChargerAlreadyConfirmed
	}
	r.confirmation[pos] = confirmation
	if plan, _ := r.FindConfirmedSharedChargerPlan(ctx, subject, ref, now); plan != nil {
		r.pending = plan.ReminderFor(plan.CardAt(now))
	}
	return nil
}

func (r *sharedChargerS18MemoryRepo) FindConfirmedSharedChargerPlan(_ context.Context, subject string, ref domain.SharedChargerRef,
	now time.Time,
) (*domain.SharedChargerConfirmedPlan, error) {
	if !r.active(ref, now) || r.member(subject, 0) < 0 ||
		r.confirmation[0].ConfirmedAt.IsZero() || r.confirmation[1].ConfirmedAt.IsZero() {
		return nil, nil
	}
	return &domain.SharedChargerConfirmedPlan{
		Ref: ref, PlaceID: r.spec.PlaceID, ExpiresAt: r.spec.ExpiresAt,
		ReminderVehicleID: r.spec.ReminderVehicleID, Confirmations: r.confirmation,
	}, nil
}

func (r *sharedChargerS18MemoryRepo) RevokeSharedCharger(_ context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64, _ time.Time,
) error {
	if r.ref != ref || r.revoked || (vehicleID != 0 && r.member(subject, vehicleID) < 0) {
		return port.ErrNotFound
	}
	r.revoked, r.pending = true, nil
	return nil
}

func (r *sharedChargerS18MemoryRepo) PublishDueSharedChargerReminders(_ context.Context, now time.Time, _ int) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.active(r.ref, now) || r.pending == nil || r.published || now.Before(r.pending.SwapAt) || !now.Before(r.pending.ExpiresAt) {
		return 0, nil
	}
	r.published = true
	return 1, nil
}

func (r *sharedChargerS18MemoryRepo) FindSharedChargerReminder(_ context.Context, subject string, ref domain.SharedChargerRef,
	now time.Time,
) (*domain.SharedChargerReminder, error) {
	if !r.active(ref, now) || !r.published || r.pending == nil || !now.Before(r.pending.ExpiresAt) ||
		r.member(subject, r.pending.VehicleID) < 0 {
		return nil, nil
	}
	return r.pending, nil
}
