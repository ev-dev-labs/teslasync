package smartdeliverysvc

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

func (s *Service) NotifyCharging(ctx context.Context, candidate readinessport.Candidate) error {
	if !s.Available() || s.candidates == nil || s.quietHours == nil {
		return nil
	}
	if !validSubject(candidate.Plan.Subject) || candidate.Plan.ID <= 0 || candidate.Plan.VehicleID <= 0 ||
		candidate.Decision.Reason != readiness.ReasonEligible {
		return ErrInvalidInput
	}
	if !allowsChargingDelivery(candidate) {
		return nil
	}
	quiet, err := s.inQuietHours(ctx, candidate.Plan.Subject, "warn", s.now().UTC())
	if err != nil {
		return err
	}
	if quiet {
		s.record("quiet_hours")
		return nil
	}
	devices, err := s.repository.ListChargingDevices(ctx, candidate.Plan.Subject)
	if err != nil {
		return fmt.Errorf("list eligible personal delivery devices: %w", err)
	}
	for _, id := range devices {
		if err := s.notifyChargingDevice(ctx, candidate, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) notifyChargingDevice(ctx context.Context, candidate readinessport.Candidate, deviceID int64) error {
	now := s.now().UTC()
	if !now.Before(candidate.Decision.ExpiresAt) {
		return nil
	}
	token, tokenHash, err := newToken()
	if err != nil {
		return err
	}
	attempt := domain.ChargingAttempt{
		Subject: candidate.Plan.Subject, DeviceID: deviceID, PlanID: candidate.Plan.ID,
		VehicleID: candidate.Plan.VehicleID, PlanVersion: candidate.Plan.Version,
		PlaceUpdatedAt: candidate.PlaceUpdatedAt, DecisionKind: string(candidate.Decision.Kind),
		DepartureAt: candidate.Plan.DepartureAt,
		TokenHash:   tokenHash[:], CreatedAt: now, ExpiresAt: candidate.Decision.ExpiresAt,
	}
	lease, err := s.repository.LockCharging(ctx, attempt)
	if err != nil || lease == nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lease.Close(closeCtx)
	}()
	current, err := s.candidates.FindCandidate(ctx, attempt.Subject, attempt.VehicleID, attempt.PlanID, candidate.Decision.Kind)
	if err != nil {
		return fmt.Errorf("recheck personal charging evidence: %w", err)
	}
	now = s.now().UTC()
	if current == nil || !allowsChargingDelivery(*current) || current.Plan.Version != attempt.PlanVersion ||
		current.Decision.Kind != candidate.Decision.Kind || !current.PlaceUpdatedAt.Equal(attempt.PlaceUpdatedAt) ||
		!now.Before(current.Decision.ExpiresAt) || !now.Before(attempt.ExpiresAt) {
		s.record("suppressed")
		return nil
	}
	quiet, err := s.inQuietHours(ctx, attempt.Subject, "warn", now)
	if err != nil {
		return err
	}
	if quiet {
		s.record("quiet_hours")
		return nil
	}
	if current.Decision.ExpiresAt.Before(attempt.ExpiresAt) {
		attempt.ExpiresAt = current.Decision.ExpiresAt
	}
	attempt.CreatedAt = now
	if attempt.ExpiresAt.Sub(now) < time.Second {
		return nil
	}
	reserved, err := lease.Reserve(ctx, attempt)
	if err != nil || !reserved {
		return err
	}
	status := s.sendPersonal(ctx, "charging", lease.Ciphertext(), token, attempt.ExpiresAt)
	s.record(string(status))
	if err := lease.Finish(ctx, tokenHash[:], status); err != nil {
		return fmt.Errorf("record personal charging delivery: %w", err)
	}
	return nil
}

func (s *Service) sendPersonal(ctx context.Context, kind, ciphertext, token string, expiresAt time.Time) domain.DeliveryStatus {
	plaintext, err := s.encryptor.Decrypt(ciphertext)
	if err != nil {
		return domain.DeliveryFailed
	}
	var subscription domain.Subscription
	if json.Unmarshal([]byte(plaintext), &subscription) != nil || !validSubscription(&subscription) {
		return domain.DeliveryFailed
	}
	payload, err := json.Marshal(struct {
		Kind  string `json:"kind"`
		Token string `json:"token"`
	}{Kind: kind, Token: token})
	if err != nil {
		return domain.DeliveryFailed
	}
	ttl := expiresAt.Sub(s.now().UTC())
	if ttl < time.Second {
		return domain.DeliveryFailed
	}
	status, err := s.sender.Send(ctx, subscription, payload, ttl)
	if err != nil {
		return domain.DeliveryUnknown
	}
	if status != domain.DeliveryAccepted && status != domain.DeliveryFailed && status != domain.DeliveryUnknown {
		return domain.DeliveryUnknown
	}
	return status
}

func (s *Service) ClaimCharging(ctx context.Context, subject, token string) (*domain.Notification, error) {
	if !validSubject(subject) || !validToken(token) {
		return nil, ErrInvalidInput
	}
	if !s.Available() || s.candidates == nil || s.quietHours == nil {
		return nil, port.ErrNotFound
	}
	now := s.now().UTC()
	quiet, err := s.inQuietHours(ctx, subject, "warn", now)
	if err != nil {
		return nil, err
	}
	if quiet {
		return nil, port.ErrNotFound
	}
	hash := sha256.Sum256([]byte(token))
	ref, err := s.repository.FindDelivery(ctx, subject, hash[:], now)
	if err != nil {
		return nil, err
	}
	candidate, err := s.candidates.FindCandidate(ctx, subject, ref.VehicleID, ref.PlanID, readiness.DecisionKind(ref.DecisionKind))
	if err != nil {
		return nil, fmt.Errorf("recheck claimed charging evidence: %w", err)
	}
	now = s.now().UTC()
	if candidate == nil || !allowsChargingDelivery(*candidate) || candidate.Plan.Version != ref.PlanVersion ||
		string(candidate.Decision.Kind) != ref.DecisionKind ||
		!candidate.PlaceUpdatedAt.Equal(ref.PlaceUpdatedAt) || !now.Before(candidate.Decision.ExpiresAt) {
		return nil, port.ErrNotFound
	}
	quiet, err = s.inQuietHours(ctx, subject, "warn", now)
	if err != nil {
		return nil, err
	}
	if quiet {
		return nil, port.ErrNotFound
	}
	result, err := s.repository.ConsumeDelivery(ctx, subject, *ref, now)
	if err == nil {
		s.record("claimed")
	}
	return result, err
}

func allowsChargingDelivery(candidate readinessport.Candidate) bool {
	switch candidate.Decision.Kind {
	case readiness.DecisionTripReview:
		// The estimate calls for another stop, but we have not verified one the driver can use.
		return false
	case readiness.DecisionDepartureOverlap:
		return candidate.Plan.DepartureOverlapPush
	default:
		return !candidate.Decision.RequiresFeasibleRemedy(candidate.Plan) || candidate.Decision.FeasibleRemedy
	}
}

func (s *Service) inQuietHours(ctx context.Context, subject, severity string, now time.Time) (bool, error) {
	if s.quietHours == nil {
		return true, errors.New("personal quiet hours are unavailable")
	}
	if subject == personaldomain.OpenSubject {
		subject = ""
	}
	windows, err := s.quietHours.ListByUser(ctx, subject)
	if err != nil {
		if ctx.Err() != nil {
			return true, ctx.Err()
		}
		return true, errors.New("read personal quiet hours")
	}
	_, quiet := notification.MatchActiveWindow(windows, severity, now)
	return quiet, nil
}

func (s *Service) record(outcome string) {
	if s.observe != nil {
		s.observe(outcome)
	}
}
