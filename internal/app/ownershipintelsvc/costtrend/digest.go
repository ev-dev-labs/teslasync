// Package costtrend manages opt-in, private monthly ownership cost reviews.
package costtrend

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/costtrend"
	"golang.org/x/text/currency"
)

var ErrInvalidSettings = errors.New("invalid charging cost review settings")

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

func timeZone(zone string) *time.Location {
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
	loc, code := timeZone(settings.TimeZone), settings.Currency
	unit, err := currency.ParseISO(code)
	if loc == nil || settings.ID < 0 || settings.Paused && settings.ID == 0 ||
		err != nil || unit == currency.XXX || code != unit.String() ||
		settings.MaterialChangeMinor <= 0 || settings.MaterialChangeMinor > domain.MaxCostMinor {
		return ErrInvalidSettings
	}
	var next *time.Time
	if !settings.Paused {
		now := s.now()
		release := releaseAt(monthStart(now.In(loc)))
		at := now.UTC()
		if release.After(now) {
			at = release.UTC()
		}
		next = &at
	}
	return s.repo.Replace(ctx, scope, settings, next)
}

func (s *Reviews) Delete(ctx context.Context, scope port.Scope, settingsID int64) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if settingsID <= 0 {
		return ErrInvalidSettings
	}
	return s.repo.Delete(ctx, scope, settingsID)
}

func (s *Reviews) Dismiss(ctx context.Context, scope port.Scope, settingsID int64, through time.Time) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if settingsID <= 0 || through.IsZero() {
		return ErrInvalidSettings
	}
	return s.repo.Dismiss(ctx, scope, settingsID, through, s.now())
}

type Batch struct {
	Outcomes  map[domain.Reason]int
	Published int
}

func (s *Reviews) ProcessDue(ctx context.Context, limit int) (Batch, error) {
	out := Batch{Outcomes: make(map[domain.Reason]int)}
	if s.reader == nil || limit <= 0 || limit > 10 {
		return out, ErrInvalidSettings
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(15*time.Minute))
		if job == nil || err != nil {
			return out, err
		}
		loc := timeZone(job.TimeZone)
		if !validScope(job.Scope) || loc == nil {
			return out, ErrInvalidSettings
		}
		through := monthStart(now.In(loc))
		release := releaseAt(through)
		next := releaseAt(through.AddDate(0, 1, 0)).UTC()
		var digest *domain.Digest
		if now.Before(release) {
			next = release.UTC()
		} else {
			from, current := through.AddDate(0, -2, 0), through.AddDate(0, -1, 0)
			priorPeriod, currentPeriod, err := s.reader.ReadCostPeriods(ctx, job.Subject, job.VehicleID, job.Currency, from, current, through)
			if err != nil {
				return out, err
			}
			attribution, reason := domain.Compare(priorPeriod, currentPeriod, job.Currency, job.MaterialChangeMinor)
			out.Outcomes[reason]++
			if attribution != nil {
				digest = &domain.Digest{PriorFrom: from.UTC(), CurrentFrom: current.UTC(), Through: through.UTC(),
					CheckedAt: now, ExpiresAt: next, Attribution: *attribution}
			}
		}
		published, err := s.repo.Finish(ctx, *job, s.now(), next, digest)
		if err != nil {
			return out, err
		}
		if published {
			out.Published++
		}
	}
	return out, nil
}

func releaseAt(first time.Time) time.Time {
	return time.Date(first.Year(), first.Month(), 2, 9, 0, 0, 0, first.Location())
}

func monthStart(local time.Time) time.Time {
	return time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, local.Location())
}
