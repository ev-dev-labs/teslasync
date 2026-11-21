package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type ParkReserveCandidates interface {
	CanDeliver(context.Context, readiness.ParkReserveScope, int64, int64, bool) (bool, error)
}

func WithParkReserveDelivery(repo port.ParkReserveRepository, plans ParkReserveCandidates) Option {
	return func(s *Service) { s.parkRepo, s.parkPlans = repo, plans }
}

func (s *Service) ParkReserveAvailable() bool {
	return s.Available() && s.parkRepo != nil && s.parkPlans != nil && s.quietHours != nil
}

func (s *Service) DeliverParkReserve(ctx context.Context, limit int) error {
	if !s.ParkReserveAvailable() || limit <= 0 {
		return nil
	}
	now := s.now().UTC()
	pending, err := s.parkRepo.ListParkReserveDeliveries(ctx, now, min(limit, 10))
	if err != nil {
		return err
	}
	var result error
	for _, ref := range pending {
		result = errors.Join(result, s.notifyParkReserve(ctx, ref))
	}
	return errors.Join(result, s.parkRepo.PruneParkReserveDeliveries(ctx, now))
}

func (s *Service) notifyParkReserve(ctx context.Context, ref domain.ParkReserveRef) error {
	lease, err := s.parkRepo.LockParkReserve(ctx, ref, s.now().UTC())
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	ok, err := s.parkReserveEligible(ctx, ref, true)
	if err != nil || !ok {
		return err
	}
	token, hash, err := newToken()
	if err != nil {
		return err
	}
	now := s.now().UTC()
	if ref.ExpiresAt.Sub(now) < time.Second {
		return nil
	}
	reserved, err := lease.Reserve(ctx, hash[:], now, ref.ExpiresAt)
	if err != nil || !reserved {
		return err
	}
	ok, err = s.parkReserveEligible(ctx, ref, false)
	status := domain.DeliveryFailed
	if err == nil && ok {
		status = s.sendPersonal(ctx, "park-reserve", lease.Ciphertext(), token, ref.ExpiresAt)
	}
	s.record(string(status))
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return errors.Join(err, lease.Finish(saveCtx, hash[:], status))
}

func (s *Service) ClaimParkReserve(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.ParkReserveAvailable() || subject == personal.OpenSubject || subject == "open-mode" {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.parkRepo.FindParkReserveDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	eligible, err := s.parkReserveEligible(ctx, *ref, true)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !eligible || !ref.ExpiresAt.After(now) {
		return nil, port.ErrNotFound
	}
	notification, err := s.parkRepo.ConsumeParkReserveDelivery(ctx, subject, hash[:], now)
	if err == nil {
		s.record("claimed")
	}
	return notification, err
}

func (s *Service) parkReserveEligible(ctx context.Context, ref domain.ParkReserveRef, recheckHistory bool) (bool, error) {
	now := s.now().UTC()
	if !ref.ExpiresAt.After(now) {
		return false, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "info", now)
	if err != nil || quiet {
		if err == nil {
			s.record("quiet_hours")
		}
		return false, err
	}
	ok, err := s.parkPlans.CanDeliver(ctx, readiness.ParkReserveScope{Subject: ref.Subject, VehicleID: ref.VehicleID},
		ref.PlanID, ref.DeviceID, recheckHistory)
	if errors.Is(err, readiness.ErrNotFound) || (err == nil && !ok) {
		s.record("suppressed")
		return false, nil
	}
	return ok, err
}
