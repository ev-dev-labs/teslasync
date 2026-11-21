package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const sharedTripConfirmationLifetime = 24 * time.Hour

var ErrSharedTripOperatorRequired = errors.New("shared trip operator required")

// SharedTripActor must be derived by the trusted browser authentication
// boundary, not from request payload, query parameters, or API-key identity.
type SharedTripActor struct {
	Subject         string
	VerifiedBrowser bool
	Impersonating   bool
}

type SharedTripAuthority func(context.Context, string) bool

type SharedTripLiveSignals interface {
	GetSignal(context.Context, int64, string, signal.LiveSignalReadPreference) (*signal.Value, error)
}

type SharedTripService struct {
	repository port.SharedTripRepository
	live       SharedTripLiveSignals
	isOperator SharedTripAuthority
	now        func() time.Time
}

func NewSharedTripService(
	repository port.SharedTripRepository, live SharedTripLiveSignals, authority SharedTripAuthority, now func() time.Time,
) *SharedTripService {
	if repository == nil || live == nil {
		panic("smartreadinesssvc.NewSharedTripService: repository and live signals are required")
	}
	if now == nil {
		now = time.Now
	}
	return &SharedTripService{repository: repository, live: live, isOperator: authority, now: now}
}

func (s *SharedTripService) SaveTrip(ctx context.Context, actor SharedTripActor, draft domain.SharedTripDraft) (*domain.SharedTrip, error) {
	if !s.canManage(ctx, actor) {
		return nil, ErrSharedTripOperatorRequired
	}
	now := s.now().UTC()
	draft.DepartureAt = draft.DepartureAt.UTC().Truncate(time.Microsecond)
	if draft.ID < 0 || draft.Revision < 0 || (draft.ID == 0) != (draft.Revision == 0) ||
		!now.Before(draft.DepartureAt) || draft.DepartureAt.After(now.AddDate(1, 0, 0)) ||
		len(draft.Nominations) < 2 || len(draft.Nominations) > domain.MaxSharedTripVehicles {
		return nil, ErrInvalidInput
	}
	seen := make(map[int64]bool, len(draft.Nominations))
	for _, entry := range draft.Nominations {
		if !validSharedTripSubject(entry.Subject) || entry.VehicleID <= 0 || seen[entry.VehicleID] {
			return nil, ErrInvalidInput
		}
		seen[entry.VehicleID] = true
	}
	return s.repository.SaveSharedTrip(ctx, actor.Subject, draft, now)
}

func (s *SharedTripService) CancelTrip(ctx context.Context, actor SharedTripActor, tripID, revision int64) error {
	if !s.canManage(ctx, actor) {
		return ErrSharedTripOperatorRequired
	}
	if tripID <= 0 || revision <= 0 {
		return ErrInvalidInput
	}
	return s.repository.CancelSharedTrip(ctx, actor.Subject, tripID, revision, s.now().UTC())
}

func (s *SharedTripService) ListOwnedTrips(ctx context.Context, actor SharedTripActor, limit, offset int) ([]domain.SharedTrip, error) {
	if !s.canManage(ctx, actor) {
		return nil, ErrSharedTripOperatorRequired
	}
	limit, offset = sharedTripPage(limit, offset)
	return s.repository.ListOwnedSharedTrips(ctx, actor.Subject, s.now().UTC(), limit, offset)
}

func (s *SharedTripService) ListInvitations(ctx context.Context, actor SharedTripActor, limit, offset int) ([]domain.SharedTripInvitation, error) {
	if !actor.acceptable() {
		return nil, port.ErrNotFound
	}
	limit, offset = sharedTripPage(limit, offset)
	return s.repository.ListSharedTripInvitations(ctx, actor.Subject, s.now().UTC(), limit, offset)
}

func (s *SharedTripService) ConfirmVehicle(
	ctx context.Context, actor SharedTripActor, key domain.SharedTripEntryKey, input domain.SharedTripConfirmationInput,
) error {
	if !actor.acceptable() {
		return port.ErrNotFound
	}
	if !validSharedTripEntryKey(key) || input.TripUseLowPct == nil || input.TripUseHighPct == nil ||
		input.ReservePct == nil || input.ScheduleClear == nil || input.MaintenanceClear == nil ||
		!finiteBetween(*input.TripUseLowPct, 0, 100) || !finiteBetween(*input.TripUseHighPct, *input.TripUseLowPct, 100) ||
		!finiteBetween(*input.ReservePct, 0, 100) {
		return ErrInvalidInput
	}
	now := s.now().UTC()
	return s.repository.ConfirmSharedTripVehicle(ctx, actor.Subject, key, domain.SharedTripConfirmation{
		TripUseLowPct: *input.TripUseLowPct, TripUseHighPct: *input.TripUseHighPct, ReservePct: *input.ReservePct,
		ScheduleClear: *input.ScheduleClear, MaintenanceClear: *input.MaintenanceClear,
		ConfirmedAt: now, ExpiresAt: now.Add(sharedTripConfirmationLifetime),
	})
}

func (s *SharedTripService) WithdrawVehicle(ctx context.Context, actor SharedTripActor, key domain.SharedTripEntryKey) error {
	if !actor.acceptable() {
		return port.ErrNotFound
	}
	if !validSharedTripEntryKey(key) {
		return ErrInvalidInput
	}
	return s.repository.WithdrawSharedTripVehicle(ctx, actor.Subject, key, s.now().UTC())
}

func (s *SharedTripService) Comparison(ctx context.Context, actor SharedTripActor, tripID int64) (*domain.SharedTripComparison, error) {
	if !actor.acceptable() || tripID <= 0 {
		return nil, port.ErrNotFound
	}
	now := s.now().UTC()
	initial, err := s.repository.ReadSharedTripComparison(ctx, actor.Subject, tripID, now)
	if err != nil {
		return nil, fmt.Errorf("read shared trip consent: %w", err)
	}
	if !validSharedTripScope(initial, tripID, now) {
		return nil, port.ErrNotFound
	}
	confirmed := sharedTripConfirmed(initial.Confirmed, now)
	if len(confirmed) < 2 {
		return nil, nil
	}

	type chargeObservation struct {
		version    int64
		chargePct  float64
		observedAt time.Time
	}
	observations := make(map[int64]chargeObservation, len(confirmed))
	for _, entry := range initial.Confirmed {
		id := entry.VehicleID
		if _, ok := confirmed[id]; !ok {
			continue
		}
		readAt := s.now().UTC()
		if !readAt.Before(initial.AccessExpiresAt) || !readAt.Before(initial.Trip.DepartureAt) {
			return nil, port.ErrNotFound
		}
		if !readAt.Before(entry.ExpiresAt) {
			continue
		}
		value, err := s.live.GetSignal(ctx, id, "BatteryLevel", signal.LiveSignalReadLocal)
		if err != nil {
			return nil, fmt.Errorf("read shared trip charge evidence: %w", err)
		}
		if !freshObservation(value, s.now().UTC()) {
			continue
		}
		pct, ok := signal.Float64(value.Raw)
		if ok && finiteBetween(pct, 0, 100) {
			observations[id] = chargeObservation{entry.EntryVersion, pct, value.Timestamp}
		}
	}
	if len(observations) < 2 {
		return nil, nil
	}

	// A confirmation can be withdrawn or superseded while fetching live
	// evidence. Recheck the audience and avoid combining across revisions.
	current, err := s.repository.ReadSharedTripComparison(ctx, actor.Subject, tripID, s.now().UTC())
	if err != nil {
		return nil, fmt.Errorf("recheck shared trip consent: %w", err)
	}
	now = s.now().UTC()
	if !validSharedTripScope(current, tripID, now) || current.Trip.Revision != initial.Trip.Revision ||
		!current.Trip.DepartureAt.Equal(initial.Trip.DepartureAt) {
		return nil, port.ErrNotFound
	}
	candidates := make([]domain.SharedTripVehicleInput, 0, len(observations))
	for id, entry := range sharedTripConfirmed(current.Confirmed, now) {
		obs, ok := observations[id]
		if !ok || obs.version != entry.EntryVersion {
			continue
		}
		candidates = append(candidates, domain.SharedTripVehicleInput{
			VehicleID: id, StartingLowPct: obs.chargePct, StartingHighPct: obs.chargePct,
			TripUseLowPct: entry.TripUseLowPct, TripUseHighPct: entry.TripUseHighPct, ReservePct: entry.ReservePct,
			ScheduleClear: true, MaintenanceClear: true, ObservedAt: obs.observedAt,
			EvidenceExpiresAt: minTime(obs.observedAt.Add(signal.LiveSignalFreshnessThreshold), entry.ExpiresAt),
		})
	}
	options := domain.CompareSharedTripVehicles(now, current.Trip.DepartureAt, candidates)
	if len(options) == 0 {
		return nil, nil
	}
	expiresAt := current.AccessExpiresAt
	for _, option := range options {
		expiresAt = minTime(expiresAt, option.ExpiresAt)
	}
	return &domain.SharedTripComparison{SharedTrip: current.Trip, ExpiresAt: expiresAt.UTC(), Options: options}, nil
}

func (s *SharedTripService) canManage(ctx context.Context, actor SharedTripActor) bool {
	return actor.acceptable() && s.isOperator != nil && s.isOperator(ctx, actor.Subject)
}

func (actor SharedTripActor) acceptable() bool {
	return actor.VerifiedBrowser && !actor.Impersonating && validSharedTripSubject(actor.Subject)
}

func validSharedTripSubject(subject string) bool {
	return subject != "" && subject != personal.OpenSubject && len(subject) <= 256 && utf8.ValidString(subject) &&
		strings.TrimSpace(subject) == subject && !strings.ContainsFunc(subject, unicode.IsControl)
}

func sharedTripPage(limit, offset int) (int, int) {
	if limit <= 0 || limit > port.MaxSharedTripPageSize {
		limit = port.MaxSharedTripPageSize
	}
	return limit, min(max(0, offset), port.MaxSharedTripPageOffset)
}

func validSharedTripEntryKey(key domain.SharedTripEntryKey) bool {
	return key.TripID > 0 && key.Revision > 0 && key.VehicleID > 0 && key.EntryVersion > 0
}

func validSharedTripScope(scope *port.SharedTripComparisonScope, tripID int64, now time.Time) bool {
	return scope != nil && scope.Trip.ID == tripID && scope.Trip.Revision > 0 && now.Before(scope.Trip.DepartureAt) &&
		now.Before(scope.AccessExpiresAt) && len(scope.Confirmed) <= domain.MaxSharedTripVehicles
}

func sharedTripConfirmed(entries []domain.SharedTripConfirmedVehicle, now time.Time) map[int64]domain.SharedTripConfirmedVehicle {
	seen := make(map[int64]bool, len(entries))
	confirmed := make(map[int64]domain.SharedTripConfirmedVehicle, len(entries))
	for _, entry := range entries {
		if seen[entry.VehicleID] {
			delete(confirmed, entry.VehicleID)
			continue
		}
		seen[entry.VehicleID] = true
		if entry.VehicleID > 0 && entry.EntryVersion > 0 && entry.ScheduleClear && entry.MaintenanceClear &&
			!entry.ConfirmedAt.IsZero() && !entry.ConfirmedAt.After(now) && now.Before(entry.ExpiresAt) &&
			finiteBetween(entry.TripUseLowPct, 0, 100) && finiteBetween(entry.TripUseHighPct, entry.TripUseLowPct, 100) &&
			finiteBetween(entry.ReservePct, 0, 100) {
			confirmed[entry.VehicleID] = entry
		}
	}
	return confirmed
}
