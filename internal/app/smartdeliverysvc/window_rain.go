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

type WindowRainCandidates interface {
	CanDeliver(context.Context, readiness.WindowRainScope, int64, int64) (bool, error)
}

func WithWindowRainDelivery(repo port.WindowRainRepository, plans WindowRainCandidates) Option {
	return func(s *Service) { s.rainRepo, s.rainPlans = repo, plans }
}

func (s *Service) WindowRainAvailable() bool {
	return s.Available() && s.rainRepo != nil && s.rainPlans != nil && s.quietHours != nil
}

func (s *Service) DeliverWindowRain(ctx context.Context, limit int) error {
	if !s.WindowRainAvailable() || limit <= 0 {
		return nil
	}
	now := s.now().UTC()
	pending, err := s.rainRepo.ListWindowRainDeliveries(ctx, now, min(limit, 4))
	if err != nil {
		return err
	}
	var result error
	for _, ref := range pending {
		result = errors.Join(result, s.notifyWindowRain(ctx, ref))
	}
	return errors.Join(result, s.rainRepo.PruneWindowRainDeliveries(ctx, now))
}

func (s *Service) notifyWindowRain(ctx context.Context, ref domain.WindowRainRef) error {
	return s.notifyExpiringPersonal(ctx, "window-rain", ref.ExpiresAt,
		func(ctx context.Context, now time.Time) (port.ExpiringDispatchLease, error) {
			return s.rainRepo.LockWindowRain(ctx, ref, now)
		}, func(ctx context.Context) (bool, error) {
			return s.windowRainEligible(ctx, ref)
		}, metrics.RecordWindowRain)
}

func (s *Service) notifyExpiringPersonal(ctx context.Context, kind string, expiresAt time.Time,
	lock func(context.Context, time.Time) (port.ExpiringDispatchLease, error),
	eligible func(context.Context) (bool, error), observe func(string, int),
) error {
	lease, err := lock(ctx, s.now().UTC())
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	ok, err := eligible(ctx)
	if err != nil || !ok {
		return err
	}
	token, hash, err := newToken()
	if err != nil {
		return err
	}
	now := s.now().UTC()
	if expiresAt.Sub(now) < time.Second {
		return nil
	}
	reserved, err := lease.Reserve(ctx, hash[:], now, expiresAt)
	if err != nil || !reserved {
		return err
	}
	ok, err = eligible(ctx)
	status := domain.DeliveryFailed
	if err == nil && ok {
		status = s.sendPersonal(ctx, kind, lease.Ciphertext(), token, expiresAt)
	}
	s.record(string(status))
	observe(string(status), 1)
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return errors.Join(err, lease.Finish(saveCtx, hash[:], status))
}

func (s *Service) ClaimWindowRain(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.WindowRainAvailable() || subject == personal.OpenSubject || subject == "open-mode" {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.rainRepo.FindWindowRainDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	eligible, err := s.windowRainEligible(ctx, *ref)
	if err != nil {
		return nil, err
	}
	if !eligible {
		return nil, port.ErrNotFound
	}
	notification, err := s.rainRepo.ConsumeWindowRainDelivery(ctx, subject, hash[:], s.now().UTC())
	if err == nil {
		s.record("claimed")
		metrics.RecordWindowRain("claimed", 1)
	}
	return notification, err
}

func (s *Service) windowRainEligible(ctx context.Context, ref domain.WindowRainRef) (bool, error) {
	now := s.now().UTC()
	if !ref.ExpiresAt.After(now) {
		return false, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "info", now)
	if err != nil || quiet {
		if err == nil {
			metrics.RecordWindowRain("quiet_hours", 1)
		}
		return false, err
	}
	ok, err := s.rainPlans.CanDeliver(ctx, readiness.WindowRainScope{Subject: ref.Subject, VehicleID: ref.VehicleID},
		ref.PlanID, ref.DeviceID)
	if errors.Is(err, readiness.ErrNotFound) || (err == nil && !ok) {
		metrics.RecordWindowRain("suppressed", 1)
		return false, nil
	}
	return ok, err
}
