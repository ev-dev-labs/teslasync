package smartmediasvc

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type FavoriteDigests struct {
	repo port.FavoriteDigestRepository
	now  func() time.Time
}

func NewFavoriteDigests(repo port.FavoriteDigestRepository, now func() time.Time) *FavoriteDigests {
	return &FavoriteDigests{repo: repo, now: now}
}

func validFavoriteScope(scope port.Scope) bool {
	return scope.VehicleID > 0 && validSubject(scope.Subject)
}

func favoriteLocation(zone string) *time.Location {
	if zone == "" || zone == "Local" || len(zone) > 80 || strings.HasPrefix(zone, "/") {
		return nil
	}
	loc, _ := time.LoadLocation(zone)
	return loc
}

func (s *FavoriteDigests) Read(ctx context.Context, scope port.Scope) (domain.FavoriteDigestSettings, error) {
	if !validFavoriteScope(scope) {
		return domain.FavoriteDigestSettings{}, ErrInvalidInput
	}
	return s.repo.ReadFavoriteDigest(ctx, scope, s.now().UTC())
}

func (s *FavoriteDigests) Save(ctx context.Context, scope port.Scope, setup domain.FavoriteDigestSetup) error {
	if !validFavoriteScope(scope) || setup.ExpectedRevision == nil || *setup.ExpectedRevision < 0 ||
		!setup.Confirmed || (setup.Paused && *setup.ExpectedRevision == 0) {
		return ErrInvalidInput
	}
	loc := favoriteLocation(setup.TimeZone)
	if loc == nil {
		return ErrInvalidInput
	}
	var next *time.Time
	if !setup.Paused {
		_, _, release := favoriteWeek(s.now(), loc)
		next = &release
	}
	return s.repo.ReplaceFavoriteDigest(ctx, scope, setup, next)
}

func (s *FavoriteDigests) Clear(ctx context.Context, scope port.Scope, revision int64) error {
	if !validFavoriteScope(scope) || revision <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteFavoriteDigest(ctx, scope, revision)
}

func (s *FavoriteDigests) Act(ctx context.Context, scope port.Scope, action domain.FavoriteDigestAction) error {
	if !validFavoriteScope(scope) || action.Revision <= 0 {
		return ErrInvalidInput
	}
	switch action.Action {
	case "confirm", "remove":
		key, err := hex.DecodeString(action.Key)
		if err != nil || len(key) != 32 || action.Key != hex.EncodeToString(key) ||
			(action.Action == "confirm") == action.DigestUntil.IsZero() {
			return ErrInvalidInput
		}
	case "dismiss":
		if action.Key != "" || action.DigestUntil.IsZero() {
			return ErrInvalidInput
		}
	default:
		return ErrInvalidInput
	}
	return s.repo.ActOnFavoriteDigest(ctx, scope, action, s.now().UTC())
}

type FavoriteDigestBatch struct {
	Checked       int
	Published     int
	NotQualified  int
	EvidenceLimit int
}

func (s *FavoriteDigests) ProcessDue(ctx context.Context, limit int) (FavoriteDigestBatch, error) {
	var batch FavoriteDigestBatch
	if limit < 1 || limit > 10 {
		return batch, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimFavoriteDigest(ctx, now, now.Add(5*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc := favoriteLocation(job.TimeZone)
		if loc == nil {
			return batch, ErrInvalidInput
		}
		from, until, next := favoriteWeek(now, loc)
		drives, samples, err := s.repo.FavoriteEvidence(ctx, *job, from, until, maxFavoriteDrives+1)
		switch {
		case errors.Is(err, port.ErrChanged):
			continue
		case err != nil && !errors.Is(err, signal.ErrTimelineEventLimit):
			return batch, err
		}
		batch.Checked++
		limited := errors.Is(err, signal.ErrTimelineEventLimit) || len(drives) > maxFavoriteDrives
		if limited {
			batch.EvidenceLimit++
			drives = nil
		}
		digest := domain.FavoriteDigest{From: from, Until: until, ExpiresAt: next,
			Candidates: FavoriteCandidates(drives, samples, from, until, loc)}
		if !limited && len(digest.Candidates) == 0 {
			batch.NotQualified++
		}
		published, err := s.repo.FinishFavoriteDigest(ctx, *job, s.now().UTC(), next, digest)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}
