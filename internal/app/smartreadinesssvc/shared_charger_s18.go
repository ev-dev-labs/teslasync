package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var ErrSharedChargerOperatorRequired = errors.New("trusted shared charger operator required")

// SharedChargerAuthority must check the exact trusted browser operator policy.
// The caller passes the verified signed-in subject, never a body or query field.
type SharedChargerAuthority func(ctx context.Context, subject string) (bool, error)

type SharedChargerService struct {
	repository port.SharedChargerRepository
	authority  SharedChargerAuthority
	clock      func() time.Time
}

func NewSharedChargerService(repository port.SharedChargerRepository, authority SharedChargerAuthority, clock func() time.Time) *SharedChargerService {
	if repository == nil {
		panic("smartreadinesssvc.NewSharedChargerService: repository must not be nil")
	}
	if clock == nil {
		clock = time.Now
	}
	return &SharedChargerService{repository: repository, authority: authority, clock: clock}
}

func (s *SharedChargerService) Authorize(ctx context.Context, subject string, expected domain.SharedChargerRef,
	spec domain.SharedChargerAuthorization,
) (domain.SharedChargerRef, error) {
	if err := s.requireOperator(ctx, subject); err != nil {
		return domain.SharedChargerRef{}, err
	}
	now := s.now()
	spec.ExpiresAt = sharedChargerInstant(spec.ExpiresAt)
	spec.PlaceUpdatedAt = spec.PlaceUpdatedAt.UTC()
	a, b := spec.Participants[0], spec.Participants[1]
	if (expected != (domain.SharedChargerRef{}) && !validSharedChargerRef(expected)) ||
		spec.PlaceID <= 0 || !validSharedChargerInstant(spec.PlaceUpdatedAt) ||
		!spec.PlaceUpdatedAt.Equal(sharedChargerInstant(spec.PlaceUpdatedAt)) ||
		!validSharedChargerInstant(spec.ExpiresAt) || !now.Before(spec.ExpiresAt) ||
		a.VehicleID <= 0 || b.VehicleID <= 0 || a.VehicleID == b.VehicleID ||
		!validSharedChargerSubject(a.Subject) || !validSharedChargerSubject(b.Subject) ||
		(spec.ReminderVehicleID != 0 && spec.ReminderVehicleID != a.VehicleID && spec.ReminderVehicleID != b.VehicleID) {
		return domain.SharedChargerRef{}, ErrInvalidInput
	}
	return s.repository.AuthorizeSharedCharger(ctx, subject, expected, spec, now)
}

func (s *SharedChargerService) Invitation(ctx context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64,
) (*domain.SharedChargerInvitation, error) {
	if !validSharedChargerSubject(subject) || !validSharedChargerRef(ref) || vehicleID <= 0 {
		return nil, ErrInvalidInput
	}
	return s.repository.FindSharedChargerInvitation(ctx, subject, ref, vehicleID, s.now())
}

func (s *SharedChargerService) ListPlanning(ctx context.Context, subject string, limit, offset int) (port.SharedChargerPlanning, error) {
	if !validSharedChargerSubject(subject) || limit < 1 || limit > 50 || offset < 0 || offset > 10000 {
		return port.SharedChargerPlanning{}, ErrInvalidInput
	}
	err := s.requireOperator(ctx, subject)
	if err != nil && !errors.Is(err, ErrSharedChargerOperatorRequired) {
		return port.SharedChargerPlanning{}, err
	}
	canManage := err == nil
	listing, err := s.repository.ListSharedChargerPlanning(ctx, subject, canManage, s.now(), limit, offset)
	listing.CanManage = canManage
	if !canManage {
		listing.Owned = nil
	}
	return listing, err
}

type SharedChargerConfirmationInput struct {
	AvailableAt        time.Time
	DepartureAt        time.Time
	EnergyNeededWh     float64
	ConservativePowerW float64
	AlreadyPlugged     *bool // Omitted occupancy is not evidence that the plug is free.
	AcceptReminder     bool
}

func (s *SharedChargerService) Confirm(ctx context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64, input SharedChargerConfirmationInput,
) error {
	now := s.now()
	availableAt, departureAt := sharedChargerInstant(input.AvailableAt), sharedChargerInstant(input.DepartureAt)
	if availableAt.Before(input.AvailableAt) {
		availableAt = availableAt.Add(time.Microsecond)
	}
	if !validSharedChargerSubject(subject) || !validSharedChargerRef(ref) || vehicleID <= 0 || input.AlreadyPlugged == nil ||
		!validSharedChargerInstant(availableAt) || !validSharedChargerInstant(departureAt) ||
		!availableAt.Before(departureAt) || !now.Before(departureAt) ||
		!finiteSharedChargerMeasurement(input.EnergyNeededWh) || input.EnergyNeededWh < 0 ||
		!finiteSharedChargerMeasurement(input.ConservativePowerW) || input.ConservativePowerW <= 0 {
		return ErrInvalidInput
	}
	return s.repository.ConfirmSharedCharger(ctx, subject, ref, domain.SharedChargerConfirmation{
		Request: domain.SharedChargerRequest{
			VehicleID: vehicleID, AvailableAt: availableAt, DepartureAt: departureAt,
			EnergyNeededWh: input.EnergyNeededWh, ConservativePowerW: input.ConservativePowerW,
			AlreadyPlugged: *input.AlreadyPlugged,
		},
		ConfirmedAt: now, AcceptReminder: input.AcceptReminder,
	})
}

func (s *SharedChargerService) Card(ctx context.Context, subject string, ref domain.SharedChargerRef) (*domain.SharedChargerCard, error) {
	if !validSharedChargerSubject(subject) || !validSharedChargerRef(ref) {
		return nil, ErrInvalidInput
	}
	now := s.now()
	plan, err := s.repository.FindConfirmedSharedChargerPlan(ctx, subject, ref, now)
	if err != nil || plan == nil {
		return nil, err
	}
	return plan.CardAt(now), nil
}

func (s *SharedChargerService) Withdraw(ctx context.Context, subject string, ref domain.SharedChargerRef, vehicleID int64) error {
	if !validSharedChargerSubject(subject) || !validSharedChargerRef(ref) || vehicleID <= 0 {
		return ErrInvalidInput
	}
	return s.repository.RevokeSharedCharger(ctx, subject, ref, vehicleID, s.now())
}

func (s *SharedChargerService) Revoke(ctx context.Context, subject string, ref domain.SharedChargerRef) error {
	if err := s.requireOperator(ctx, subject); err != nil {
		return err
	}
	if !validSharedChargerRef(ref) {
		return ErrInvalidInput
	}
	return s.repository.RevokeSharedCharger(ctx, subject, ref, 0, s.now())
}

func (s *SharedChargerService) PublishDueReminders(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	return s.repository.PublishDueSharedChargerReminders(ctx, s.now(), min(limit, 50))
}

func (s *SharedChargerService) Reminder(ctx context.Context, subject string, ref domain.SharedChargerRef) (*domain.SharedChargerReminder, error) {
	if !validSharedChargerSubject(subject) || !validSharedChargerRef(ref) {
		return nil, ErrInvalidInput
	}
	return s.repository.FindSharedChargerReminder(ctx, subject, ref, s.now())
}

func (s *SharedChargerService) requireOperator(ctx context.Context, subject string) error {
	if !validSharedChargerSubject(subject) || s.authority == nil {
		return ErrSharedChargerOperatorRequired
	}
	allowed, err := s.authority(ctx, subject)
	if err != nil {
		return fmt.Errorf("check shared charger operator authority: %w", err)
	}
	if !allowed {
		return ErrSharedChargerOperatorRequired
	}
	return nil
}

func (s *SharedChargerService) now() time.Time { return sharedChargerInstant(s.clock()) }

func validSharedChargerRef(ref domain.SharedChargerRef) bool { return ref.ID > 0 && ref.Revision > 0 }

func validSharedChargerSubject(subject string) bool {
	return subject != "" && len(subject) <= 256 && subject != personal.OpenSubject && strings.TrimSpace(subject) == subject &&
		utf8.ValidString(subject) && strings.IndexFunc(subject, unicode.IsControl) < 0
}

func sharedChargerInstant(at time.Time) time.Time { return at.UTC().Truncate(time.Microsecond) }

func validSharedChargerInstant(at time.Time) bool {
	return !at.IsZero() && at.Year() >= 1 && at.Year() <= 9999
}

func finiteSharedChargerMeasurement(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
