package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type CabinPrepCandidates interface {
	Read(context.Context, readinessport.CabinPrepScope) (readiness.CabinPrepPlan, error)
}

func WithCabinPrepDelivery(repo port.CabinPrepRepository, plans CabinPrepCandidates) Option {
	return func(s *Service) { s.cabinRepo, s.cabinPlans = repo, plans }
}

func (s *Service) CabinPrepAvailable() bool {
	return s.Available() && s.cabinRepo != nil && s.cabinPlans != nil && s.quietHours != nil
}

func (s *Service) DeliverCabinPrep(ctx context.Context, limit int) error {
	if !s.CabinPrepAvailable() || limit <= 0 {
		return nil
	}
	now := s.now().UTC()
	pending, err := s.cabinRepo.ListCabinPrepDeliveries(ctx, now, min(limit, 10))
	if err != nil {
		return err
	}
	var result error
	for _, ref := range pending {
		result = errors.Join(result, s.notifyCabinPrep(ctx, ref))
	}
	return errors.Join(result, s.cabinRepo.PruneCabinPrepDeliveries(ctx, now))
}

func (s *Service) notifyCabinPrep(ctx context.Context, ref domain.CabinPrepRef) error {
	lease, err := s.cabinRepo.LockCabinPrep(ctx, ref, s.now().UTC())
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	deadline, err := s.cabinPrepDeadline(ctx, ref)
	if err != nil || deadline.Sub(s.now().UTC()) < time.Second {
		return err
	}
	token, hash, err := newToken()
	if err != nil {
		return err
	}
	reserved, err := lease.Reserve(ctx, hash[:], s.now().UTC(), deadline)
	if err != nil || !reserved {
		return err
	}
	ref.ExpiresAt = deadline
	deadline, err = s.cabinPrepDeadline(ctx, ref)
	status := domain.DeliveryFailed
	if err == nil && deadline.Sub(s.now().UTC()) >= time.Second {
		status = s.sendPersonal(ctx, "cabin-prep", lease.Ciphertext(), token, deadline)
	}
	s.record(string(status))
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return errors.Join(err, lease.Finish(saveCtx, hash[:], status))
}

func (s *Service) ClaimCabinPrep(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.CabinPrepAvailable() || subject == personal.OpenSubject || subject == "open-mode" {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.cabinRepo.FindCabinPrepDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	deadline, err := s.cabinPrepDeadline(ctx, *ref)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !now.Before(deadline) {
		return nil, port.ErrNotFound
	}
	notification, err := s.cabinRepo.ConsumeCabinPrepDelivery(ctx, subject, hash[:], now)
	if err == nil {
		s.record("claimed")
	}
	return notification, err
}

func (s *Service) cabinPrepDeadline(ctx context.Context, ref domain.CabinPrepRef) (time.Time, error) {
	now := s.now().UTC()
	if !ref.ExpiresAt.After(now) {
		return time.Time{}, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "info", now)
	if err != nil || quiet {
		if err == nil {
			s.record("quiet_hours")
		}
		return time.Time{}, err
	}
	plan, err := s.cabinPlans.Read(ctx, readinessport.CabinPrepScope{Subject: ref.Subject, VehicleID: ref.VehicleID})
	if err != nil {
		if errors.Is(err, readinessport.ErrNotFound) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	if plan.ID != ref.PlanID || plan.DeviceID != ref.DeviceID || !plan.DeviceReady || plan.Estimate == nil ||
		plan.ExpiresAt == nil || !plan.DepartureAt.Equal(ref.DepartureAt) {
		s.record("suppressed")
		return time.Time{}, nil
	}
	if plan.ExpiresAt.Before(ref.ExpiresAt) {
		return *plan.ExpiresAt, nil
	}
	return ref.ExpiresAt, nil
}
