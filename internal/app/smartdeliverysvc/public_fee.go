package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
)

type PublicFeeCandidates interface {
	FindPublicFeeDecision(context.Context, string, int64) (*readiness.PublicFeeDecision, error)
}

func WithPublicFeeDelivery(repository port.PublicFeeRepository, candidates PublicFeeCandidates) Option {
	return func(s *Service) { s.publicFees, s.feeSource = repository, candidates }
}

func (s *Service) PublicFeeAvailable() bool {
	return s.Available() && s.publicFees != nil && s.feeSource != nil && s.quietHours != nil
}

func (s *Service) NotifyPublicFee(ctx context.Context, decision readiness.PublicFeeDecision) error {
	if !s.PublicFeeAvailable() || decision.Terms.PushDeviceID == nil {
		return nil
	}
	ref := domain.PublicFeeRef{
		Subject: decision.Terms.Subject, DeviceID: *decision.Terms.PushDeviceID, VehicleID: decision.Terms.VehicleID,
		PlaceID: decision.Terms.PlaceID, SessionID: decision.SessionID, PlaceUpdatedAt: decision.Terms.PlaceUpdatedAt,
		ConfirmedAt: decision.Terms.ConfirmedAt, ExpiresAt: decision.ExpiresAt,
	}
	lease, err := s.publicFees.LockPublicFee(ctx, ref, s.now().UTC())
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	deadline, err := s.publicFeeDeadline(ctx, ref)
	if err != nil || deadline.Sub(s.now().UTC()) < time.Second {
		return err
	}
	token, tokenHash, err := newToken()
	if err != nil {
		return err
	}
	reserved, err := lease.Reserve(ctx, tokenHash[:], s.now().UTC(), deadline)
	if err != nil || !reserved {
		return err
	}
	ref.ExpiresAt = deadline
	deadline, eligibilityErr := s.publicFeeDeadline(ctx, ref)
	status := domain.DeliveryFailed
	if eligibilityErr == nil && deadline.Sub(s.now().UTC()) >= time.Second {
		status = s.sendPersonal(ctx, "public-fee", lease.Ciphertext(), token, deadline)
	}
	s.record(string(status))
	if err := lease.Finish(ctx, tokenHash[:], status); err != nil {
		return err
	}
	return eligibilityErr
}

func (s *Service) ClaimPublicFee(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.PublicFeeAvailable() {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.publicFees.FindPublicFeeDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	deadline, err := s.publicFeeDeadline(ctx, *ref)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !now.Before(deadline) {
		return nil, port.ErrNotFound
	}
	notification, err := s.publicFees.ConsumePublicFeeDelivery(ctx, subject, hash[:], now)
	if err == nil {
		s.record("claimed")
	}
	return notification, err
}

func (s *Service) publicFeeDeadline(ctx context.Context, ref domain.PublicFeeRef) (time.Time, error) {
	now := s.now().UTC()
	if !now.Before(ref.ExpiresAt) {
		return time.Time{}, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "warn", now)
	if err != nil || quiet {
		if quiet && err == nil {
			s.record("quiet_hours")
		}
		return time.Time{}, err
	}
	current, err := s.feeSource.FindPublicFeeDecision(ctx, ref.Subject, ref.VehicleID)
	if err != nil {
		return time.Time{}, err
	}
	if current == nil || current.SessionID != ref.SessionID || current.Terms.PlaceID != ref.PlaceID ||
		current.Terms.PushDeviceID == nil || *current.Terms.PushDeviceID != ref.DeviceID ||
		!current.Terms.ConfirmedAt.Equal(ref.ConfirmedAt) || !current.Terms.PlaceUpdatedAt.Equal(ref.PlaceUpdatedAt) {
		s.record("suppressed")
		return time.Time{}, nil
	}
	if current.ExpiresAt.Before(ref.ExpiresAt) {
		return current.ExpiresAt, nil
	}
	return ref.ExpiresAt, nil
}
