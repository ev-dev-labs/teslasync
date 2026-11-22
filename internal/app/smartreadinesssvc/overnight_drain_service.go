package smartreadinesssvc

import (
	"bytes"
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	overnightReviewDelay = 15 * time.Minute
	overnightRetry       = 2 * time.Hour
)

type OvernightDrainReviews struct {
	repo    port.OvernightDrainRepository
	history *OvernightDrainHistory
	now     func() time.Time
}

func NewOvernightDrainReviews(repo port.OvernightDrainRepository, history *OvernightDrainHistory, now func() time.Time) *OvernightDrainReviews {
	if now == nil {
		now = time.Now
	}
	return &OvernightDrainReviews{repo: repo, history: history, now: now}
}

func validOvernightScope(scope port.OvernightDrainScope) bool {
	return scope.VehicleID > 0 && validRecallSubject(scope.Subject)
}

func (s *OvernightDrainReviews) Read(ctx context.Context, scope port.OvernightDrainScope) (domain.OvernightDrainSettings, error) {
	if !validOvernightScope(scope) {
		return domain.OvernightDrainSettings{}, port.ErrNotFound
	}
	settings, err := s.repo.ReadOvernightDrain(ctx, scope, s.now())
	if err != nil || settings.Plan == nil || settings.Plan.Review == nil {
		return settings, err
	}
	review := settings.Plan.Review
	loc := stopTimeZone(settings.Plan.TimeZone)
	if loc == nil {
		return domain.OvernightDrainSettings{}, ErrInvalidInput
	}
	if s.history == nil || len(review.EvidenceFingerprint) == 0 {
		settings.Plan.Review = nil
		return settings, nil
	}
	proof, err := s.history.fingerprint(ctx, scope.VehicleID, review, loc)
	if err != nil {
		return domain.OvernightDrainSettings{}, err
	}
	if !bytes.Equal(proof, review.EvidenceFingerprint) {
		settings.Plan.Review = nil
		return settings, nil
	}
	// Scope and occurrence are checked again after the evidence read so a completed
	// pause, dismissal, or disable during the lookup cannot return the old card.
	fresh, err := s.repo.ReadOvernightDrain(ctx, scope, s.now())
	if fresh.Plan != nil && fresh.Plan.Review != nil &&
		(fresh.Plan.ID != settings.Plan.ID || !fresh.Plan.Review.MorningAt.Equal(review.MorningAt) ||
			!bytes.Equal(fresh.Plan.Review.EvidenceFingerprint, proof)) {
		fresh.Plan.Review = nil
	}
	return fresh, err
}

func (s *OvernightDrainReviews) Save(ctx context.Context, scope port.OvernightDrainScope, expectedID int64, zone string, paused bool) error {
	if !validOvernightScope(scope) {
		return port.ErrNotFound
	}
	loc := stopTimeZone(zone)
	if loc == nil || expectedID < 0 || (paused && expectedID == 0) {
		return ErrInvalidInput
	}
	var next *time.Time
	if !paused {
		now := s.now().In(loc)
		_, morning := overnightWindow(now)
		at := morning.Add(overnightReviewDelay)
		if at.Before(now) {
			_, morning = overnightWindow(now.AddDate(0, 0, 1))
			at = morning.Add(overnightReviewDelay)
		}
		next = &at
	}
	return s.repo.ReplaceOvernightDrain(ctx, scope, expectedID, zone, next)
}

func (s *OvernightDrainReviews) Disable(ctx context.Context, scope port.OvernightDrainScope, id int64) error {
	if !validOvernightScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteOvernightDrain(ctx, scope, id)
}

func (s *OvernightDrainReviews) Dismiss(ctx context.Context, scope port.OvernightDrainScope, id int64, morning time.Time) error {
	if !validOvernightScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 || morning.IsZero() {
		return ErrInvalidInput
	}
	return s.repo.DismissOvernightDrain(ctx, scope, id, morning, s.now())
}

type OvernightDrainBatch struct {
	Outcomes  map[domain.OvernightDrainReason]int
	Published int
}

func (s *OvernightDrainReviews) ProcessDue(ctx context.Context, limit int) (OvernightDrainBatch, error) {
	batch := OvernightDrainBatch{Outcomes: make(map[domain.OvernightDrainReason]int)}
	if s.history == nil || limit < 1 || limit > 20 {
		return batch, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimOvernightDrain(ctx, now, now.Add(5*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc := stopTimeZone(job.TimeZone)
		if loc == nil {
			return batch, ErrInvalidInput
		}
		local := now.In(loc)
		_, morning := overnightWindow(local)
		_, tomorrow := overnightWindow(local.AddDate(0, 0, 1))
		next := tomorrow.Add(overnightReviewDelay)
		if local.Before(morning.Add(overnightReviewDelay)) {
			next = morning.Add(overnightReviewDelay)
		}
		var review *domain.OvernightDrainReview
		var reason domain.OvernightDrainReason
		expiry := overnightReviewExpires(local)
		if !local.Before(morning.Add(overnightReviewDelay)) && local.Before(expiry) {
			review, reason, err = s.history.Review(ctx, job.VehicleID, local, now)
			if err != nil {
				return batch, err
			}
			batch.Outcomes[reason]++
			if review != nil {
				review.MorningAt, review.ExpiresAt = morning.UTC(), expiry.UTC()
			} else if retry := local.Add(overnightRetry); retry.Before(expiry) {
				next = retry
			}
		}
		checked := s.now()
		if review != nil && !checked.Before(expiry) {
			review = nil
		}
		published, err := s.repo.FinishOvernightDrain(ctx, *job, checked, next, review)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}
