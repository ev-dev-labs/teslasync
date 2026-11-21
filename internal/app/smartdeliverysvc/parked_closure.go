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

type ParkedClosureCandidates interface {
	CanDeliver(context.Context, readiness.ParkedClosureScope, int64, int64, int64, time.Time) (bool, error)
}

func WithParkedClosureDelivery(repo port.ParkedClosureRepository, plans ParkedClosureCandidates) Option {
	return func(s *Service) { s.closureRepo, s.closurePlans = repo, plans }
}

func (s *Service) ParkedClosureAvailable() bool {
	return s.Available() && s.closureRepo != nil && s.closurePlans != nil && s.quietHours != nil
}

func (s *Service) DeliverParkedClosures(ctx context.Context, limit int) error {
	if !s.ParkedClosureAvailable() || limit <= 0 {
		return nil
	}
	now := s.now().UTC()
	pending, err := s.closureRepo.ListParkedClosureDeliveries(ctx, now, min(limit, 6))
	if err != nil {
		return err
	}
	var result error
	for _, ref := range pending {
		err := s.notifyExpiringPersonal(ctx, "parked-closure", ref.ExpiresAt,
			func(ctx context.Context, now time.Time) (port.ExpiringDispatchLease, error) {
				return s.closureRepo.LockParkedClosure(ctx, ref, now)
			}, func(ctx context.Context) (bool, error) {
				return s.parkedClosureEligible(ctx, ref)
			}, metrics.RecordParkedClosure)
		result = errors.Join(result, err)
	}
	return errors.Join(result, s.closureRepo.PruneParkedClosureDeliveries(ctx, now))
}

func (s *Service) ClaimParkedClosure(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.ParkedClosureAvailable() || subject == personal.OpenSubject || subject == "open-mode" {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.closureRepo.FindParkedClosureDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	ok, err := s.parkedClosureEligible(ctx, *ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, port.ErrNotFound
	}
	notification, err := s.closureRepo.ConsumeParkedClosureDelivery(ctx, subject, hash[:], s.now().UTC())
	if err == nil {
		s.record("claimed")
		metrics.RecordParkedClosure("claimed", 1)
	}
	return notification, err
}

func (s *Service) parkedClosureEligible(ctx context.Context, ref domain.ParkedClosureRef) (bool, error) {
	now := s.now().UTC()
	if !ref.ExpiresAt.After(now) {
		return false, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "info", now)
	if err != nil || quiet {
		if err == nil {
			metrics.RecordParkedClosure("quiet_hours", 1)
		}
		return false, err
	}
	ok, err := s.closurePlans.CanDeliver(ctx, readiness.ParkedClosureScope{Subject: ref.Subject, VehicleID: ref.VehicleID},
		ref.PlanID, ref.DeviceID, ref.ParkID, ref.OpenSince)
	if errors.Is(err, readiness.ErrNotFound) || (err == nil && !ok) {
		metrics.RecordParkedClosure("suppressed", 1)
		return false, nil
	}
	return ok, err
}
