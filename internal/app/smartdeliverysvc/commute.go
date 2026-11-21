package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
)

type CommuteOriginCheck func(context.Context, int64, commute.Point, time.Time) (bool, error)

func WithCommuteDelivery(repository port.CommuteRepository, atOrigin CommuteOriginCheck) Option {
	return func(s *Service) { s.commute, s.atOrigin = repository, atOrigin }
}

func (s *Service) CommuteAvailable() bool {
	return s.Available() && s.commute != nil && s.atOrigin != nil && s.quietHours != nil
}

func (s *Service) SetCommuteEnabled(ctx context.Context, subject string, id int64, enabled bool, copy domain.Copy) error {
	if !validSubject(subject) || id <= 0 || (enabled && (!validText(copy.Title) || !validText(copy.Body))) {
		return ErrInvalidInput
	}
	if s.commute == nil || (enabled && !s.CommuteAvailable()) {
		return ErrUnavailable
	}
	return s.commute.SetCommuteEnabled(ctx, subject, id, enabled, copy, s.now().UTC())
}

func (s *Service) NotifyCommute(
	ctx context.Context, subject string, consentID, routineID int64, departureAt time.Time,
) error {
	if !s.CommuteAvailable() {
		return nil
	}
	if !validSubject(subject) || consentID <= 0 || routineID <= 0 || departureAt.IsZero() {
		return ErrInvalidInput
	}
	lease, err := s.commute.LockCommute(ctx, subject, domain.CommuteOccurrence{
		ConsentID: consentID, RoutineID: routineID, DepartureAt: departureAt,
	}, s.now().UTC())
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	candidate := lease.Candidate()
	eligible, err := s.commuteEligible(ctx, subject, candidate)
	if err != nil || !eligible {
		return err
	}
	now := s.now().UTC()
	if candidate.ExpiresAt.Sub(now) < time.Second {
		return nil
	}
	token, tokenHash, err := newToken()
	if err != nil {
		return err
	}
	reserved, err := lease.Reserve(ctx, tokenHash[:], now)
	if err != nil || !reserved {
		return err
	}
	eligible, eligibilityErr := s.commuteEligible(ctx, subject, candidate)
	if eligible {
		var departed bool
		departed, eligibilityErr = lease.Departed(ctx, s.now().UTC())
		eligible = eligibilityErr == nil && !departed
	}
	status := domain.DeliveryFailed
	if eligible {
		status = s.sendPersonal(ctx, "commute", lease.Ciphertext(), token, candidate.ExpiresAt)
	}
	s.record(string(status))
	if err := lease.Finish(ctx, tokenHash[:], status); err != nil {
		return fmt.Errorf("record personal commute delivery: %w", err)
	}
	return eligibilityErr
}

func (s *Service) ClaimCommute(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.CommuteAvailable() {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	candidate, err := s.commute.FindCommuteDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	eligible, err := s.commuteEligible(ctx, subject, *candidate)
	if err != nil {
		return nil, err
	}
	if !eligible {
		return nil, port.ErrNotFound
	}
	result, err := s.commute.ConsumeCommuteDelivery(ctx, subject, hash[:], s.now().UTC())
	if err == nil {
		s.record("claimed")
	}
	return result, err
}

func (s *Service) commuteEligible(ctx context.Context, subject string, c domain.CommuteDelivery) (bool, error) {
	now := s.now().UTC()
	if !now.Before(c.ExpiresAt) {
		return false, nil
	}
	quiet, err := s.inQuietHours(ctx, subject, "info", now)
	if err != nil || quiet {
		return false, err
	}
	return s.atOrigin(ctx, c.VehicleID, c.Origin, s.now().UTC())
}
