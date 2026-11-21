// Package monthlytariff manages private, consented monthly tariff replays.
package monthlytariff

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/monthlytariff"
)

var ErrInvalidSettings = errors.New("invalid monthly tariff review settings")

type Reviews struct {
	repo   port.Repository
	reader port.EvidenceReader
	now    func() time.Time
}

func NewReviews(repo port.Repository, reader port.EvidenceReader, now func() time.Time) *Reviews {
	if now == nil {
		now = time.Now
	}
	return &Reviews{repo: repo, reader: reader, now: now}
}

func validScope(scope port.Scope) bool {
	subject := scope.Subject
	return scope.VehicleID > 0 && len(subject) > 0 && len(subject) <= 512 &&
		strings.TrimSpace(subject) == subject && subject != personal.OpenSubject && subject != "open-mode"
}

func localTime(zone string) *time.Location {
	if zone == "" || zone == "Local" || len(zone) > 80 {
		return nil
	}
	loc, _ := time.LoadLocation(zone)
	return loc
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope) (domain.Review, error) {
	if !validScope(scope) {
		return domain.Review{}, port.ErrNotFound
	}
	return s.repo.Read(ctx, scope, s.now())
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, settings domain.Settings) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	loc := localTime(settings.TimeZone)
	if !settings.Valid() || loc == nil {
		return ErrInvalidSettings
	}
	var next *time.Time
	if !settings.Paused {
		now := s.now()
		check := maxTime(now, release(monthStart(now.In(loc)))).UTC()
		next = &check
	}
	return s.repo.Replace(ctx, scope, settings, next)
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
	if s.reader == nil || limit <= 0 || limit > 10 {
		return batch, ErrInvalidSettings
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(15*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc := localTime(job.TimeZone)
		if !validScope(job.Scope) || loc == nil {
			return batch, ErrInvalidSettings
		}
		through := monthStart(now.In(loc))
		next := release(through.AddDate(0, 1, 0)).UTC()
		var draft *domain.Digest
		if first := release(through); now.Before(first) {
			next = first.UTC()
		} else {
			from := through.AddDate(0, -1, 0)
			evidence, current, alternative, err := s.reader.ReadEvidence(ctx, *job, from, through)
			if err != nil {
				return batch, err
			}
			outcome := domain.UnsupportedTariff
			if current.ID != 0 && alternative.ID != 0 {
				var comparison *domain.Comparison
				comparison, outcome = domain.Replay(evidence, current, alternative, job.SwitchFeeMinor, job.MinimumMinor)
				if comparison != nil {
					draft = &domain.Digest{From: from.UTC(), Through: through.UTC(), CheckedAt: now, ExpiresAt: next,
						Comparison: *comparison}
				}
			}
			batch.Outcomes[outcome]++
		}
		published, err := s.repo.Finish(ctx, *job, s.now(), next, draft)
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

func maxTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return b
	}
	return a
}
