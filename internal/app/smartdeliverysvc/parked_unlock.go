package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type ParkedUnlockCandidates interface {
	CanDeliver(context.Context, readiness.ParkedUnlockScope, int64, int64, int64, time.Time) (bool, error)
}

func WithParkedUnlockDelivery(repo port.ParkedUnlockRepository, plans ParkedUnlockCandidates) Option {
	return func(s *Service) { s.unlockRepo, s.unlockPlans = repo, plans }
}

func (s *Service) ParkedUnlockAvailable() bool {
	return s.Available() && s.unlockRepo != nil && s.unlockPlans != nil && s.quietHours != nil
}

func (s *Service) DeliverParkedUnlocks(ctx context.Context, limit int) error {
	if !s.ParkedUnlockAvailable() || limit <= 0 {
		return nil
	}
	now := s.now().UTC()
	pending, err := s.unlockRepo.ListParkedUnlockDeliveries(ctx, now, min(limit, 6))
	if err != nil {
		return err
	}
	var result error
	for _, ref := range pending {
		err := s.notifyExpiringPersonal(ctx, "parked-unlock", ref.ExpiresAt,
			func(ctx context.Context, now time.Time) (port.ExpiringDispatchLease, error) {
				return s.unlockRepo.LockParkedUnlock(ctx, ref, now)
			}, func(ctx context.Context) (bool, error) {
				return s.parkedUnlockEligible(ctx, ref)
			}, metrics.RecordParkedUnlock)
		result = errors.Join(result, err)
	}
	return errors.Join(result, s.unlockRepo.PruneParkedUnlockDeliveries(ctx, now))
}

func (s *Service) ClaimParkedUnlock(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.ParkedUnlockAvailable() || subject == personal.OpenSubject || subject == "open-mode" {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.unlockRepo.FindParkedUnlockDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	ok, err := s.parkedUnlockEligible(ctx, *ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, port.ErrNotFound
	}
	notification, err := s.unlockRepo.ConsumeParkedUnlockDelivery(ctx, subject, hash[:], s.now().UTC())
	if err == nil {
		s.record("claimed")
		metrics.RecordParkedUnlock("claimed", 1)
	}
	return notification, err
}

func (s *Service) parkedUnlockEligible(ctx context.Context, ref domain.ParkedUnlockRef) (bool, error) {
	now := s.now().UTC()
	if !ref.ExpiresAt.After(now) {
		return false, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "info", now)
	if err != nil || quiet {
		if err == nil {
			metrics.RecordParkedUnlock("quiet_hours", 1)
		}
		return false, err
	}
	ok, err := s.unlockPlans.CanDeliver(ctx, readiness.ParkedUnlockScope{Subject: ref.Subject, VehicleID: ref.VehicleID},
		ref.PlanID, ref.DeviceID, ref.ParkID, ref.UnlockedSince)
	if errors.Is(err, readiness.ErrNotFound) || (err == nil && !ok) {
		metrics.RecordParkedUnlock("suppressed", 1)
		return false, nil
	}
	return ok, err
}
