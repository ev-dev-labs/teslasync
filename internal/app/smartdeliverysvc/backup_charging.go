package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
)

type BackupCandidates interface {
	BackupDecision(context.Context, string, int64) (*readiness.BackupChargingDecision, error)
}

func WithBackupDelivery(repo port.BackupRepository, source BackupCandidates) Option {
	return func(s *Service) { s.backupRepo, s.backupSource = repo, source }
}

func (s *Service) BackupDeliveryAvailable() bool {
	return s.Available() && s.backupRepo != nil && s.backupSource != nil && s.quietHours != nil
}

func (s *Service) NotifyBackupCharging(ctx context.Context, decision readiness.BackupChargingDecision) error {
	if !s.BackupDeliveryAvailable() {
		return nil
	}
	watch := decision.Watch
	ref := port.BackupRef{
		Subject: watch.Subject, WatchID: watch.ID, VehicleID: watch.VehicleID, DeviceID: watch.DeviceID,
		ConsentedAt: watch.ConsentedAt, OutageStart: watch.OutageStart, ObservedAt: decision.Sample.ObservedAt, ExpiresAt: decision.Sample.ExpiresAt,
	}
	lease, err := s.backupRepo.LockBackupDelivery(ctx, ref, s.now().UTC())
	if lease == nil || err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	deadline, err := s.backupDeadline(ctx, ref)
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
	deadline, recheck := s.backupDeadline(ctx, ref)
	status := domain.DeliveryFailed
	if recheck == nil && deadline.Sub(s.now().UTC()) >= time.Second {
		status = s.sendPersonal(ctx, "backup-charging", lease.Ciphertext(), token, deadline)
	}
	s.record(string(status))
	if err := lease.Finish(ctx, tokenHash[:], status); err != nil {
		return err
	}
	return recheck
}

func (s *Service) ClaimBackupCharging(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.BackupDeliveryAvailable() {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.backupRepo.FindBackupDelivery(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return nil, err
	}
	expires, err := s.backupDeadline(ctx, *ref)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if !now.Before(expires) {
		return nil, port.ErrNotFound
	}
	notification, err := s.backupRepo.ConsumeBackupDelivery(ctx, *ref, hash[:], expires, s.now)
	if err != nil {
		return nil, err
	}
	s.record("claimed")
	notification.URL = fmt.Sprintf("/settings/smart-charging?vehicle_id=%d&backup_watch_id=%d#backup-charging", ref.VehicleID, ref.WatchID)
	return notification, nil
}

func (s *Service) backupDeadline(ctx context.Context, ref port.BackupRef) (time.Time, error) {
	now := s.now().UTC()
	if !now.Before(ref.ExpiresAt) {
		return time.Time{}, nil
	}
	quiet, err := s.inQuietHours(ctx, ref.Subject, "warn", now)
	if err != nil || quiet {
		if err == nil {
			s.record("quiet_hours")
		}
		return time.Time{}, err
	}
	result, err := s.backupSource.BackupDecision(ctx, ref.Subject, ref.VehicleID)
	if err != nil {
		return time.Time{}, err
	}
	if result == nil || result.Watch.ID != ref.WatchID || result.Watch.DeviceID != ref.DeviceID ||
		!result.Watch.ConsentedAt.Equal(ref.ConsentedAt) || !result.Watch.OutageStart.Equal(ref.OutageStart) ||
		!result.Sample.ObservedAt.Equal(ref.ObservedAt) {
		s.record("suppressed")
		return time.Time{}, nil
	}
	if result.Sample.ExpiresAt.Before(ref.ExpiresAt) {
		return result.Sample.ExpiresAt, nil
	}
	return ref.ExpiresAt, nil
}

func (s *Service) PruneBackupCharging(ctx context.Context) error {
	if s.backupRepo == nil {
		return nil
	}
	return s.backupRepo.PruneBackupDeliveries(ctx, s.now().UTC().Add(-48*time.Hour))
}
