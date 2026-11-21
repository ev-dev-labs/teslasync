// Package subscriptionrenewal schedules private owner-confirmed renewal reviews.
package subscriptionrenewal

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	renewal "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/subscriptionrenewal"
	"github.com/google/uuid"
)

var ErrInvalid = errors.New("invalid subscription renewal terms")

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

type State struct {
	Plan        *port.Plan      `json:"plan"`
	Review      *renewal.Review `json:"review"`
	NeedsReview bool            `json:"needs_review"`
	Dismissed   bool            `json:"dismissed"`
}

func validSubject(subject string) bool {
	return subject != "" && len(subject) <= 512 && subject != personal.OpenSubject &&
		subject != domain.LegacyOpenSubject && strings.TrimSpace(subject) == subject
}

func validScope(scope port.Scope) bool {
	return scope.VehicleID > 0 && scope.SubscriptionID > 0 && validSubject(scope.Subject)
}

func validRevision(revision string) bool {
	id, err := uuid.Parse(revision)
	return err == nil && id != uuid.Nil && id.String() == revision
}

func (s *Reviews) ListCandidates(ctx context.Context, subject string, vehicle *int64, now time.Time, limit int) ([]port.Candidate, error) {
	if !validSubject(subject) || vehicle != nil && *vehicle <= 0 {
		return nil, nil
	}
	return s.repo.FindCandidates(ctx, subject, vehicle, now, min(max(limit, 1), 50))
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope) (State, error) {
	if !validScope(scope) {
		return State{}, port.ErrNotFound
	}
	sub, plan, err := s.repo.Read(ctx, scope)
	if err != nil || plan == nil {
		return State{}, err
	}
	state := State{Plan: plan, Dismissed: plan.Dismissed}
	window, ok := plan.Window()
	now := s.now()
	if !ok || sub.Version != plan.SubscriptionVersion || window.Eligible(sub, now) == renewal.IneligibleTerms {
		state.NeedsReview = true
		return state, nil
	}
	if plan.Paused || plan.Dismissed || plan.NextCheckAt != nil || plan.ReviewedAt == nil ||
		now.Before(*plan.ReviewedAt) || window.Eligible(sub, now) != renewal.Ready {
		return state, nil
	}
	rows, err := s.repo.Observations(ctx, scope, *plan, sub, window, now)
	if err != nil {
		return State{}, err
	}
	state.Review, _ = window.Evaluate(sub, now, rows)
	return state, nil
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, plan port.Plan) error {
	if !validScope(scope) || (plan.Revision != "" && !validRevision(plan.Revision)) || plan.SubscriptionVersion <= 0 {
		return ErrInvalid
	}
	sub, existing, err := s.repo.Read(ctx, scope)
	if err != nil {
		return err
	}
	if sub.Version != plan.SubscriptionVersion || existing != nil && plan.Revision != existing.Revision ||
		existing == nil && plan.Revision != "" {
		return port.ErrChanged
	}
	if plan.Paused {
		if existing == nil {
			return port.ErrChanged
		}
		plan.Terms = existing.Terms
		window, ok := plan.Window()
		if !ok {
			return ErrInvalid
		}
		return s.repo.Replace(ctx, scope, plan, time.Time{}, window.Expires)
	}
	window, ok := plan.Window()
	now := s.now()
	if !ok || !now.Before(window.Expires) || window.Expires.After(now.AddDate(1, 1, 0)) ||
		window.Eligible(sub, now) == renewal.IneligibleTerms {
		return ErrInvalid
	}
	next := window.OpensAt
	if now.After(next) {
		next = now
	}
	if sub.StartedAt.After(next) {
		next = sub.StartedAt
	}
	return s.repo.Replace(ctx, scope, plan, next, window.Expires)
}

func (s *Reviews) Dismiss(ctx context.Context, scope port.Scope, revision string) error {
	if !validScope(scope) || !validRevision(revision) {
		return ErrInvalid
	}
	return s.repo.Dismiss(ctx, scope, revision, s.now())
}

func (s *Reviews) Clear(ctx context.Context, scope port.Scope, revision string) error {
	if !validScope(scope) || !validRevision(revision) {
		return ErrInvalid
	}
	return s.repo.Delete(ctx, scope, revision)
}

type Batch struct {
	Outcomes  map[renewal.Outcome]int
	Published int
}

func (s *Reviews) ProcessDue(ctx context.Context, limit int) (Batch, error) {
	batch := Batch{Outcomes: make(map[renewal.Outcome]int)}
	if limit < 1 || limit > 20 {
		return batch, ErrInvalid
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(5*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		window, ok := job.Window()
		outcome := renewal.IneligibleTerms
		if ok && validScope(job.Scope) {
			outcome = window.Eligible(job.Subscription, now)
		}
		checkedAt := s.now()
		if outcome == renewal.Ready && !checkedAt.Before(window.Expires) {
			outcome = renewal.Expired
		}
		batch.Outcomes[outcome]++
		published, err := s.repo.Finish(ctx, *job, checkedAt, outcome == renewal.Ready)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}
