package smartmediasvc

import (
	"context"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

type TrackReviews struct {
	repo    port.TrackReviewRepository
	library port.LibraryProvider
	secrets port.SecretCodec
	now     func() time.Time
}

func NewTrackReviews(repo port.TrackReviewRepository, library port.LibraryProvider, secrets port.SecretCodec, now func() time.Time) *TrackReviews {
	return &TrackReviews{repo: repo, library: library, secrets: secrets, now: now}
}

func validDrive(scope port.DriveScope) bool {
	return validSubject(scope.Subject) && scope.DriveID > 0 && scope.VehicleID > 0
}

func (s *TrackReviews) Read(ctx context.Context, scope port.DriveScope) (*domain.DriveTrackReview, error) {
	if !validDrive(scope) {
		return nil, ErrInvalidInput
	}
	result, err := s.repo.ReadDriveTrack(ctx, scope, s.now().UTC())
	if err != nil {
		return nil, err
	}
	review := &result.Review
	review.LibraryAvailable = s.library != nil && s.secrets != nil
	review.LibraryConnected = review.LibraryAvailable && review.LibraryConnected
	if review.Reason == "pending_evidence" {
		review.Track = TrackAt(result.Samples, review.StartedAt, *review.EndedAt, *review.SelectedAt)
		review.Reason = "missing_evidence"
		if review.Track != nil {
			review.Reason = "observed"
			review.EvidenceKey = trackEvidenceKey(*review.Track)
		}
	}
	return review, nil
}

func (s *TrackReviews) Confirm(ctx context.Context, scope port.DriveScope, confirmation domain.DriveTrackConfirmation) error {
	if !validDrive(scope) || confirmation.ExpectedID == nil || *confirmation.ExpectedID < 0 || !confirmation.Confirmed ||
		confirmation.StartedAt.IsZero() || !confirmation.EndedAt.After(confirmation.StartedAt) ||
		confirmation.OffsetS == nil || *confirmation.OffsetS < 0 || *confirmation.OffsetS >= 86400 {
		return ErrInvalidInput
	}
	selected := confirmation.StartedAt.Add(time.Duration(*confirmation.OffsetS) * time.Second)
	if !selected.Before(confirmation.EndedAt) {
		return ErrInvalidInput
	}
	return s.repo.ConfirmDriveTrack(ctx, scope, confirmation, selected, s.now().UTC())
}

func (s *TrackReviews) Clear(ctx context.Context, scope port.DriveScope, id int64) error {
	if !validDrive(scope) || id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.ClearDriveTrack(ctx, scope, id, s.now().UTC())
}

func TrackAt(samples []domain.PlaybackSample, from, to, at time.Time) *domain.TrackPlay {
	if at.Before(from) || !at.Before(to) {
		return nil
	}
	var selected *domain.TrackPlay
	conflicting := false
	observedPlays(samples, from, to, false, func(track domain.TrackPlay, before, after time.Time, advanced float64) {
		gap := after.Sub(before)
		if !after.Before(to) || at.Before(before) || at.After(after) || gap > 30*time.Second ||
			math.Abs(gap.Seconds()-advanced) > 3 {
			return
		}
		if selected != nil && !selected.IdentityAt.Equal(track.IdentityAt) {
			conflicting = true
			return
		}
		selected = &track
	})
	if conflicting {
		return nil
	}
	return selected
}
