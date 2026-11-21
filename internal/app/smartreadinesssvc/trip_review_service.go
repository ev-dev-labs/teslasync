package smartreadinesssvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var ErrTripReviewNotActionable = errors.New("trip review is not actionable")

type TripReviews struct {
	repo port.TripReviewRepository
	now  func() time.Time
}

func NewTripReviews(repo port.TripReviewRepository, now func() time.Time) *TripReviews {
	if repo == nil || now == nil {
		panic("smartreadinesssvc.NewTripReviews: repository and clock are required")
	}
	return &TripReviews{repo: repo, now: now}
}

func (s *TripReviews) Settings(ctx context.Context, key domain.StopPlanKey) (domain.TripReviewState, error) {
	var state domain.TripReviewState
	if err := validateStopKey(key); err != nil {
		return state, err
	}
	has, err := s.repo.HasTripReview(ctx, key)
	if !has || err != nil {
		return state, err
	}
	state.HasSetup = true
	now := s.now().UTC()
	snapshot, err := s.repo.ReadTripReview(ctx, key, now)
	if snapshot == nil || err != nil {
		return state, err
	}
	state.Setup = &snapshot.Setup
	state.SimilarAdjustment = snapshot.SimilarAdjustment
	if snapshot.HasCompleted {
		state.Review = EvaluateTripPlanReview(snapshot.Baseline, snapshot.Journey, now)
		if state.Review != nil {
			state.Adjustment = snapshot.Adjustment
			if _, actionable := tripReviewAdjustment(*state.Review, now); actionable && state.Adjustment == nil {
				state.AdjustmentKey = tripReviewAdjustmentKey(snapshot.ScopedRevision, *state.Review)
			}
		}
	}
	return state, nil
}

func (s *TripReviews) Save(ctx context.Context, key domain.StopPlanKey, setup domain.TripReviewSetup) error {
	if err := validateStopKey(key); err != nil {
		return err
	}
	if setup.JourneyID <= 0 || setup.PlanVersion <= 0 || setup.DestinationID <= 0 ||
		setup.OriginUpdatedAt.IsZero() || setup.DestinationUpdatedAt.IsZero() ||
		!finiteBetween(setup.PlannedArrivalPct, 0, 100) {
		return ErrInvalidInput
	}
	if setup.StopPlaceID == nil {
		if setup.PlannedStopS != 0 || setup.StopPlaceUpdatedAt != nil {
			return ErrInvalidInput
		}
	} else if *setup.StopPlaceID <= 0 || *setup.StopPlaceID == setup.DestinationID ||
		setup.StopPlaceUpdatedAt == nil || setup.StopPlaceUpdatedAt.IsZero() ||
		setup.PlannedStopS <= 0 || setup.PlannedStopS > int64(tripReviewMaxStop/time.Second) {
		return ErrInvalidInput
	}
	return s.repo.ReplaceTripReview(ctx, key, setup, s.now().UTC())
}

func (s *TripReviews) Revoke(ctx context.Context, key domain.StopPlanKey) error {
	if err := validateStopKey(key); err != nil {
		return err
	}
	return s.repo.DeleteTripReview(ctx, key)
}

func (s *TripReviews) SaveAdjustment(ctx context.Context, key domain.StopPlanKey, expected string) error {
	if err := validateStopKey(key); err != nil {
		return err
	}
	if len(expected) != sha256.Size*2 {
		return ErrInvalidInput
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return ErrInvalidInput
	}
	now := s.now().UTC()
	err := s.repo.SaveTripAdjustment(ctx, key, now, func(snapshot domain.TripReviewSnapshot) (*domain.TripReviewAdjustment, error) {
		review := EvaluateTripPlanReview(snapshot.Baseline, snapshot.Journey, now)
		if !snapshot.HasCompleted || review == nil || tripReviewAdjustmentKey(snapshot.ScopedRevision, *review) != expected {
			return nil, ErrTripReviewNotActionable
		}
		if snapshot.Adjustment != nil {
			return nil, nil
		}
		adjustment, actionable := tripReviewAdjustment(*review, now)
		if !actionable {
			return nil, ErrTripReviewNotActionable
		}
		return &adjustment, nil
	})
	if errors.Is(err, port.ErrNotFound) {
		return ErrTripReviewNotActionable
	}
	return err
}

func tripReviewAdjustmentKey(revision int64, review domain.TripPlanReview) string {
	// A correction to displayed evidence requires another explicit save.
	values := fmt.Sprintf("%d:%d:%d:%g:%g:%d:%d:%d", revision, review.ArrivedAt.UnixMicro(), review.ExpiresAt.UnixMicro(),
		review.PlannedArrivalPct, review.ObservedArrivalPct, review.PlannedStopS, review.ObservedStopS, review.ObservedChargeS)
	sum := sha256.Sum256([]byte(values))
	return hex.EncodeToString(sum[:])
}

func tripReviewAdjustment(review domain.TripPlanReview, now time.Time) (domain.TripReviewAdjustment, bool) {
	extraStopS, extraArrivalPct := review.ExtraStopBudgetS, review.ArrivalShortfallPct
	if extraStopS < int64(5*time.Minute/time.Second) {
		extraStopS = 0
	}
	if extraArrivalPct < 3 {
		extraArrivalPct = 0
	}
	return domain.TripReviewAdjustment{
		SavedAt: now, ExtraStopS: extraStopS, ExtraArrivalPct: extraArrivalPct,
	}, extraStopS > 0 || extraArrivalPct > 0
}
