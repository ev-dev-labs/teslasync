// Package trippacket schedules and exposes private trip packet reviews.
package trippacket

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/trippacket"
)

var ErrInvalid = errors.New("invalid private trip packet request")

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
	return scope.VehicleID > 0 && scope.Subject != "" && len(scope.Subject) <= 512 &&
		strings.TrimSpace(scope.Subject) == scope.Subject && scope.Subject != personal.OpenSubject && scope.Subject != "open-mode"
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, plan domain.Plan) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	loc, ok := plan.Location()
	if !ok || (!plan.Version.Valid() && (plan.ID != 0 || plan.Revision != 0 || plan.Paused)) {
		return ErrInvalid
	}
	now := s.now()
	at := release(monthStart(now.In(loc)))
	if now.After(at) {
		at = now
	}
	return s.repo.Replace(ctx, scope, plan, at.UTC())
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope, driveID int64) (domain.Review, error) {
	var out domain.Review
	if !validScope(scope) {
		return out, port.ErrNotFound
	}
	plan, err := s.repo.Read(ctx, scope)
	if err != nil || plan == nil {
		return out, err
	}
	out.Plan = plan
	if plan.Paused {
		return out, nil
	}
	now := s.now()
	if driveID > 0 {
		out.Entry, err = s.repo.ReadEntry(ctx, scope, *plan, driveID, now)
		return out, err
	}
	loc, ok := plan.Location()
	if !ok {
		return out, ErrInvalid
	}
	window, expires := activeWindow(now.In(loc))
	if plan.ReviewedThrough == nil || !window.Through.Equal(*plan.ReviewedThrough) ||
		plan.DismissedThrough != nil && window.Through.Equal(*plan.DismissedThrough) {
		return out, nil
	}
	drives, receipts, err := s.repo.Sources(ctx, scope, plan.Version, window, now, nil)
	if err != nil {
		return out, err
	}
	packet, _ := domain.Prepare(window.From, window.Through, drives, receipts)
	if packet != nil {
		payload, err := json.Marshal(packet)
		if err != nil {
			return out, err
		}
		sum := sha256.Sum256(payload)
		out.Packet, out.Digest, out.Expires = packet, hex.EncodeToString(sum[:]), &expires
	}
	return out, nil
}

func (s *Reviews) EditEntry(ctx context.Context, scope port.Scope, version domain.Version, entry domain.Entry) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if !version.Valid() || !entry.Valid() {
		return ErrInvalid
	}
	plan, err := s.repo.Read(ctx, scope)
	if err != nil {
		return err
	}
	if plan == nil || plan.Paused || version != plan.Version {
		return port.ErrChanged
	}
	loc, ok := plan.Location()
	if !ok {
		return ErrInvalid
	}
	now := s.now()
	window, _ := activeWindow(now.In(loc))
	return s.repo.ReplaceEntry(ctx, scope, *plan, entry, now, window)
}

func (s *Reviews) Clear(ctx context.Context, scope port.Scope, version domain.Version) error {
	if !validScope(scope) {
		return port.ErrNotFound
	}
	if !version.Valid() {
		return ErrInvalid
	}
	return s.repo.Delete(ctx, scope, version)
}

func (s *Reviews) Dismiss(ctx context.Context, scope port.Scope, version domain.Version, through time.Time) error {
	review, err := s.Read(ctx, scope, 0)
	if err != nil {
		return err
	}
	if review.Plan == nil || review.Plan.Version != version || review.Packet == nil || !through.Equal(review.Packet.Through) {
		return port.ErrChanged
	}
	return s.repo.Dismiss(ctx, scope, version, through)
}

func (s *Reviews) Export(ctx context.Context, scope port.Scope, version domain.Version, digest string) (*domain.Packet, error) {
	review, err := s.Read(ctx, scope, 0)
	if err != nil {
		return nil, err
	}
	if review.Plan == nil || review.Plan.Version != version || review.Packet == nil || review.Expires == nil ||
		!s.now().Before(*review.Expires) || digest == "" || digest != review.Digest {
		return nil, port.ErrChanged
	}
	result := *review.Packet
	result.UnclassifiedDriveIDs = nil
	return &result, nil
}

type Batch struct {
	Outcomes  map[domain.Outcome]int
	Published int
}

func (s *Reviews) ProcessDue(ctx context.Context, limit int) (Batch, error) {
	batch := Batch{Outcomes: make(map[domain.Outcome]int)}
	if limit <= 0 || limit > 10 {
		return batch, ErrInvalid
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(15*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc, ok := job.Location()
		if !ok || !validScope(job.Scope) {
			return batch, ErrInvalid
		}
		window, next := activeWindow(now.In(loc))
		if job.DismissedThrough != nil && window.Through.Equal(*job.DismissedThrough) {
			if _, err := s.repo.Finish(ctx, *job, s.now(), next.UTC(), window.Through.UTC(), false); err != nil {
				return batch, err
			}
			continue
		}
		drives, receipts, err := s.repo.Sources(ctx, job.Scope, job.Version, window, now, &job.Lease)
		if errors.Is(err, port.ErrChanged) {
			continue
		}
		if err != nil {
			return batch, err
		}
		packet, outcome := domain.Prepare(window.From, window.Through, drives, receipts)
		batch.Outcomes[outcome]++
		published, err := s.repo.Finish(ctx, *job, s.now(), next.UTC(), window.Through.UTC(), packet != nil)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}

func activeWindow(now time.Time) (port.Window, time.Time) {
	through := monthStart(now)
	next := release(through.AddDate(0, 1, 0))
	if now.Before(release(through)) {
		next, through = release(through), through.AddDate(0, -1, 0)
	}
	return port.Window{From: through.AddDate(0, -1, 0), Through: through}, next
}

func monthStart(now time.Time) time.Time {
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
}

func release(through time.Time) time.Time {
	return time.Date(through.Year(), through.Month(), 2, 9, 0, 0, 0, through.Location())
}
