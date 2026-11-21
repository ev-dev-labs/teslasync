// Package mileageterm schedules private distance allowance digests.
package mileageterm

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/mileageterm"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/mileageterm"
)

var ErrInvalidSettings = errors.New("invalid mileage review settings")

type Reviews struct {
	repo port.Repository
	now  func() time.Time
}

func NewReviews(repo port.Repository, now func() time.Time) *Reviews {
	if now == nil {
		now = time.Now
	}
	return &Reviews{repo: repo, now: now}
}

func validScope(scope port.Scope) bool {
	subject := scope.Subject
	return scope.VehicleID > 0 && len(subject) > 0 && len(subject) <= 512 &&
		strings.TrimSpace(subject) == subject && subject != personal.OpenSubject && subject != "open-mode"
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope) (domain.Review, error) {
	if !validScope(scope) {
		return domain.Review{}, port.ErrNotFound
	}
	return s.repo.Read(ctx, scope, s.now())
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, input domain.Settings) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	term, ok := input.Term()
	if !ok {
		return ErrInvalidSettings
	}
	cutoff := term.End.Add(-7 * 24 * time.Hour)
	var next *time.Time
	if !input.Paused {
		now := s.now()
		through := monthStart(now.In(term.Start.Location()))
		firstPossible := term.Start.AddDate(0, 0, 29)
		if through.Before(firstPossible) {
			through = monthStart(firstPossible)
			if through.Before(firstPossible) {
				through = through.AddDate(0, 1, 0)
			}
		}
		at := release(through).UTC()
		if at.Before(now) {
			at = now.UTC()
		}
		if at.Before(cutoff) {
			next = &at
		}
	}
	return s.repo.Replace(ctx, scope, input, next, cutoff)
}

func (s *Reviews) Delete(ctx context.Context, scope port.Scope, id int64) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidSettings
	}
	return s.repo.Delete(ctx, scope, id)
}

func (s *Reviews) Dismiss(ctx context.Context, scope port.Scope, id int64, through time.Time) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 || through.IsZero() {
		return ErrInvalidSettings
	}
	return s.repo.Dismiss(ctx, scope, id, through, s.now())
}

type Batch struct {
	Outcomes  map[domain.Outcome]int
	Published int
}

func (s *Reviews) ProcessDue(ctx context.Context, limit int) (Batch, error) {
	batch := Batch{Outcomes: make(map[domain.Outcome]int)}
	if limit <= 0 || limit > 10 {
		return batch, ErrInvalidSettings
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(15*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		term, ok := job.Term()
		if !ok || !validScope(job.Scope) {
			return batch, ErrInvalidSettings
		}
		through := monthStart(now.In(term.Start.Location()))
		nextAt := release(through.AddDate(0, 1, 0)).UTC()
		var draft *domain.Digest
		if first := release(through); now.Before(first) {
			nextAt = first.UTC()
		} else if term.End.Sub(now) > 7*24*time.Hour && through.Sub(term.Start) >= 28*24*time.Hour {
			from := through.AddDate(0, 0, -90)
			if term.Start.After(from) {
				from = term.Start
			}
			samples, err := s.repo.ReadObservations(ctx, *job, from, through, now)
			if err != nil {
				return batch, err
			}
			projection, outcome := domain.Project(term, samples, through, now)
			batch.Outcomes[outcome]++
			if projection != nil {
				expires := term.End.Add(-7 * 24 * time.Hour)
				if nextAt.Before(expires) {
					expires = nextAt
				}
				draft = &domain.Digest{Through: through.UTC(), CheckedAt: now, ExpiresAt: expires.UTC(), Projection: *projection}
			}
		} else {
			batch.Outcomes[domain.NotActionable]++
		}
		var next *time.Time
		if term.End.Sub(nextAt) > 7*24*time.Hour {
			next = &nextAt
		}
		published, err := s.repo.Finish(ctx, *job, s.now(), nextAt, next, draft)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}

func monthStart(at time.Time) time.Time {
	return time.Date(at.Year(), at.Month(), 1, 0, 0, 0, 0, at.Location())
}

func release(at time.Time) time.Time {
	return time.Date(at.Year(), at.Month(), 2, 9, 0, 0, 0, at.Location())
}
