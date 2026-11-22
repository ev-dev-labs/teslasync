package smartmediasvc

import (
	"context"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

type Soundtracks struct {
	repo port.SoundtrackRepository
	now  func() time.Time
}

func NewSoundtracks(repo port.SoundtrackRepository, now func() time.Time) *Soundtracks {
	return &Soundtracks{repo: repo, now: now}
}

func validJourney(scope port.JourneyScope) bool {
	return validSubject(scope.Subject) && scope.VehicleID > 0 && scope.JourneyID > 0
}

func (s *Soundtracks) Read(ctx context.Context, scope port.JourneyScope) (*domain.SoundtrackReview, error) {
	if !validJourney(scope) {
		return nil, ErrInvalidInput
	}
	source, err := s.repo.ReadSoundtrack(ctx, scope, s.now().UTC())
	if err != nil {
		return nil, err
	}
	review := &source.Review
	if review.Reason != "pending_evidence" {
		return review, nil
	}
	review.MatchedDrives = len(source.Drives)
	review.Reason = "missing_evidence"
	for _, drive := range source.Drives {
		low := sort.Search(len(source.Samples), func(i int) bool { return !source.Samples[i].At.Before(drive.StartedAt) })
		high := sort.Search(len(source.Samples), func(i int) bool { return !source.Samples[i].At.Before(drive.EndedAt) })
		plays := ObservedPlays(source.Samples[low:high], drive.StartedAt, drive.EndedAt)
		if len(plays) > 0 {
			review.ObservedDrives++
		}
		if len(review.Plays)+len(plays) > 200 {
			review.Reason = "evidence_limit"
			review.ObservedDrives = 0
			review.Plays = review.Plays[:0]
			return review, nil
		}
		review.Plays = append(review.Plays, plays...)
	}
	if len(review.Plays) > 0 {
		review.Reason = "observed"
	}
	return review, nil
}

func (s *Soundtracks) Confirm(ctx context.Context, scope port.JourneyScope, confirmation domain.SoundtrackConfirmation) error {
	if !validJourney(scope) || confirmation.ExpectedID == nil || *confirmation.ExpectedID < 0 || !confirmation.Confirmed ||
		confirmation.StartedAt.IsZero() || !confirmation.EndedAt.After(confirmation.StartedAt) {
		return ErrInvalidInput
	}
	return s.repo.ConfirmSoundtrack(ctx, scope, confirmation, s.now().UTC())
}

func (s *Soundtracks) Hold(ctx context.Context, scope port.JourneyScope, id int64, snooze bool) error {
	if !validJourney(scope) || id <= 0 {
		return ErrInvalidInput
	}
	now := s.now().UTC()
	var until *time.Time
	if snooze {
		later := now.Add(24 * time.Hour)
		until = &later
	}
	return s.repo.HoldSoundtrack(ctx, scope, id, until, now)
}

func (s *Soundtracks) Clear(ctx context.Context, scope port.JourneyScope, id int64) error {
	if !validJourney(scope) || id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.ClearSoundtrack(ctx, scope, id)
}
