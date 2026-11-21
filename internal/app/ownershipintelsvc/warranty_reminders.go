package ownershipintelsvc

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	warrantyReminderRefresh = 24 * time.Hour
	warrantyReminderHorizon = 21 * 24 * time.Hour
	warrantyReminderLease   = 2 * time.Minute
)

type WarrantyReminders struct {
	repo port.WarrantyReminderRepository
	now  func() time.Time
}

func NewWarrantyReminders(repo port.WarrantyReminderRepository, now func() time.Time) *WarrantyReminders {
	if now == nil {
		now = time.Now
	}
	return &WarrantyReminders{repo: repo, now: now}
}

func validPrivateWarrantySubject(subject string) bool {
	return subject != "" && subject != personal.OpenSubject && subject != domain.LegacyOpenSubject &&
		len(subject) <= 512 && strings.TrimSpace(subject) == subject
}

func validWarrantyReminderKey(key port.WarrantyReminderKey) bool {
	return validPrivateWarrantySubject(key.Subject) && key.VehicleID > 0 && key.WarrantyID > 0
}

func (s *WarrantyReminders) Settings(ctx context.Context, key port.WarrantyReminderKey) (domain.WarrantyReminderSettings, error) {
	if !validWarrantyReminderKey(key) {
		return domain.WarrantyReminderSettings{}, ErrInvalidInput
	}
	return s.repo.WarrantyReminderSettings(ctx, key, s.now().UTC())
}

func (s *WarrantyReminders) Set(ctx context.Context, key port.WarrantyReminderKey, enabled bool) error {
	if !validWarrantyReminderKey(key) {
		return ErrInvalidInput
	}
	return s.repo.SetWarrantyReminder(ctx, key, enabled, s.now().UTC())
}

type WarrantyReminderBatch struct {
	Outcomes  map[domain.WarrantyReminderOutcome]int
	Published int
}

func (s *WarrantyReminders) ProcessDue(ctx context.Context, limit int) (WarrantyReminderBatch, error) {
	batch := WarrantyReminderBatch{Outcomes: make(map[domain.WarrantyReminderOutcome]int)}
	now := s.now().UTC()
	claims, err := s.repo.ClaimWarrantyReminders(ctx, now, now.Add(warrantyReminderLease), min(max(limit, 1), 25))
	if err != nil {
		return batch, err
	}
	var result error
	for _, claim := range claims {
		if err := ctx.Err(); err != nil {
			return batch, errors.Join(result, err)
		}
		if !validWarrantyReminderKey(claim.Key) {
			batch.Outcomes[domain.WarrantyClaimInvalidated]++
			continue
		}
		checkAt := s.now().UTC()
		from := checkAt.Add(-warrantyDistanceLookback)
		if claim.Warranty.StartAt.After(from) {
			from = claim.Warranty.StartAt
		}
		drives, err := s.repo.WarrantyReminderDrives(ctx, claim, from, checkAt)
		if err != nil {
			result = errors.Join(result, err)
			continue
		}
		projection, outcome := EvaluateWarrantyDistanceReminder(claim.Warranty, drives, checkAt)
		next := checkAt.Add(warrantyReminderRefresh)
		if projection != nil && projection.ExpiresAt.Before(next) {
			next = projection.ExpiresAt
		}
		checkedAt := s.now().UTC()
		if projection != nil && !projection.ExpiresAt.After(checkedAt) {
			projection, outcome = nil, domain.WarrantyStaleEvidence
		}
		publish := projection != nil && !claim.Published && !projection.LatestLimitAt.After(checkedAt.Add(warrantyReminderHorizon))
		saved, err := s.repo.SaveWarrantyProjection(ctx, claim, port.WarrantyProjectionUpdate{
			Projection: projection, CheckedAt: checkedAt, NextAt: next, Publish: publish,
		})
		switch {
		case err != nil:
			result = errors.Join(result, err)
		case !saved:
			batch.Outcomes[domain.WarrantyClaimInvalidated]++
		default:
			batch.Outcomes[outcome]++
			if publish {
				batch.Published++
			}
		}
	}
	return batch, result
}

func (s *WarrantyReminders) ListWarrantyReminderCandidates(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]port.WarrantyReminderCandidate, error) {
	if !validPrivateWarrantySubject(subject) {
		return nil, nil
	}
	return s.repo.ListWarrantyReminderCandidates(ctx, subject, vehicleID, now, now.Add(warrantyReminderHorizon), min(max(limit, 1), 50))
}
