package smartreadinesssvc

import (
	"bytes"
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type CapacityTrendReviews struct {
	repo    port.CapacityTrendRepository
	history *CapacityTrendHistory
	now     func() time.Time
}

func NewCapacityTrendReviews(repo port.CapacityTrendRepository, history *CapacityTrendHistory, now func() time.Time) *CapacityTrendReviews {
	if now == nil {
		now = time.Now
	}
	return &CapacityTrendReviews{repo: repo, history: history, now: now}
}

func validCapacityScope(scope port.CapacityTrendScope) bool {
	return scope.VehicleID > 0 && validRecallSubject(scope.Subject)
}

func (s *CapacityTrendReviews) Read(ctx context.Context, scope port.CapacityTrendScope) (domain.CapacityTrendSettings, error) {
	if !validCapacityScope(scope) {
		return domain.CapacityTrendSettings{}, port.ErrNotFound
	}
	settings, err := s.repo.ReadCapacityTrend(ctx, scope, s.now())
	if err != nil || settings.Plan == nil || settings.Plan.Digest == nil {
		return settings, err
	}
	digest := settings.Plan.Digest
	if s.history == nil || len(digest.EvidenceFingerprint) == 0 {
		settings.Plan.Digest = nil
		return settings, nil
	}
	proof, err := s.history.fingerprint(ctx, scope.VehicleID, digest.SourceWindows)
	if err != nil {
		return domain.CapacityTrendSettings{}, err
	}
	if !bytes.Equal(proof, digest.EvidenceFingerprint) {
		settings.Plan.Digest = nil
		return settings, nil
	}
	fresh, err := s.repo.ReadCapacityTrend(ctx, scope, s.now())
	if fresh.Plan != nil && fresh.Plan.Digest != nil &&
		(fresh.Plan.ID != settings.Plan.ID || !fresh.Plan.Digest.RecentTo.Equal(digest.RecentTo) ||
			!bytes.Equal(fresh.Plan.Digest.EvidenceFingerprint, proof)) {
		fresh.Plan.Digest = nil
	}
	return fresh, err
}

func (s *CapacityTrendReviews) Save(ctx context.Context, scope port.CapacityTrendScope, expectedID int64, zone string, paused bool) error {
	if !validCapacityScope(scope) {
		return port.ErrNotFound
	}
	loc := stopTimeZone(zone)
	if loc == nil || expectedID < 0 || (paused && expectedID == 0) {
		return ErrInvalidInput
	}
	var next *time.Time
	if !paused {
		now := s.now().In(loc)
		at := now
		if release := capacityReleaseAt(now); release.After(at) {
			at = release
		}
		next = &at
	}
	return s.repo.ReplaceCapacityTrend(ctx, scope, expectedID, zone, next)
}

func (s *CapacityTrendReviews) Disable(ctx context.Context, scope port.CapacityTrendScope, id int64) error {
	if !validCapacityScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteCapacityTrend(ctx, scope, id)
}

func (s *CapacityTrendReviews) Dismiss(ctx context.Context, scope port.CapacityTrendScope, id int64, periodEnd time.Time) error {
	if !validCapacityScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 || periodEnd.IsZero() {
		return ErrInvalidInput
	}
	return s.repo.DismissCapacityTrend(ctx, scope, id, periodEnd, s.now())
}

type CapacityTrendBatch struct {
	Outcomes  map[domain.CapacityTrendReason]int
	Published int
}

func capacityReleaseAt(local time.Time) time.Time {
	return time.Date(local.Year(), local.Month(), 2, 5, 0, 0, 0, local.Location())
}

func (s *CapacityTrendReviews) ProcessDue(ctx context.Context, limit int) (CapacityTrendBatch, error) {
	batch := CapacityTrendBatch{Outcomes: make(map[domain.CapacityTrendReason]int)}
	if s.history == nil || limit < 1 || limit > 10 {
		return batch, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimCapacityTrend(ctx, now, now.Add(15*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc := stopTimeZone(job.TimeZone)
		if loc == nil {
			return batch, ErrInvalidInput
		}
		local := now.In(loc)
		release := capacityReleaseAt(local)
		next := capacityReleaseAt(capacityMonthStart(local).AddDate(0, 1, 0))
		var digest *domain.CapacityTrendDigest
		if local.Before(release) {
			next = release
		} else {
			var reason domain.CapacityTrendReason
			digest, reason, err = s.history.Digest(ctx, job.VehicleID, local)
			if err != nil {
				return batch, err
			}
			batch.Outcomes[reason]++
			if digest != nil {
				digest.ExpiresAt = next.UTC()
			}
		}
		published, err := s.repo.FinishCapacityTrend(ctx, *job, s.now(), next, digest)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}
