package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	tripReviewDepartureWindow = time.Hour
	tripReviewEndWindow       = 30 * time.Minute
	tripReviewMaxStop         = 6 * time.Hour
	tripReviewMaxJourney      = 24 * time.Hour
	tripReviewTTL             = 30 * 24 * time.Hour
)

// EvaluateTripPlanReview requires the caller to validate ownership, revisions
// and place attribution and to pass all recorded legs and sessions in order.
func EvaluateTripPlanReview(base domain.TripReviewBaseline, journey domain.TripReviewJourney, now time.Time) *domain.TripPlanReview {
	if base.JourneyID <= 0 || journey.ID != base.JourneyID || base.VehicleID <= 0 || journey.VehicleID != base.VehicleID ||
		base.OriginPlaceID <= 0 || base.DestinationID <= 0 || base.OriginPlaceID == base.DestinationID ||
		base.SavedAt.IsZero() || !base.SavedAt.Before(base.DepartureAt) || !base.SavedAt.Before(journey.StartedAt) ||
		!journey.EndedAt.After(journey.StartedAt) || journey.EndedAt.After(now) ||
		journey.EndedAt.Sub(journey.StartedAt) > tripReviewMaxJourney || !now.Before(journey.EndedAt.Add(tripReviewTTL)) ||
		!finiteBetween(base.PlannedArrivalPct, 0, 100) {
		return nil
	}
	if base.StopPlaceID < 0 || base.StopPlaceID == base.OriginPlaceID || base.StopPlaceID == base.DestinationID ||
		(base.StopPlaceID == 0 && (base.PlannedStopS != 0 || len(journey.Drives) != 1 || len(journey.ChargeSessions) != 0)) ||
		(base.StopPlaceID > 0 && (base.PlannedStopS <= 0 || float64(base.PlannedStopS) > tripReviewMaxStop.Seconds() ||
			len(journey.Drives) != 2 || len(journey.ChargeSessions) != 1)) {
		return nil
	}
	first, last := journey.Drives[0], journey.Drives[len(journey.Drives)-1]
	departureDelta := first.StartedAt.Sub(base.DepartureAt)
	if !validTripReviewDrive(first, journey) || !validTripReviewDrive(last, journey) ||
		departureDelta < -tripReviewDepartureWindow || departureDelta > tripReviewDepartureWindow ||
		first.OriginPlaceID != base.OriginPlaceID || last.DestinationID != base.DestinationID ||
		journey.EndedAt.Sub(last.EndedAt) > tripReviewEndWindow ||
		last.EndChargePct == nil || !finiteBetween(*last.EndChargePct, 0, 100) {
		return nil
	}
	review := domain.TripPlanReview{
		ArrivedAt: last.EndedAt, ExpiresAt: journey.EndedAt.Add(tripReviewTTL),
		PlannedArrivalPct: base.PlannedArrivalPct, ObservedArrivalPct: *last.EndChargePct,
		PlannedStopS: base.PlannedStopS, ArrivalShortfallPct: max(0, base.PlannedArrivalPct-*last.EndChargePct),
	}
	if base.StopPlaceID > 0 {
		charge := journey.ChargeSessions[0]
		dwell := last.StartedAt.Sub(first.EndedAt)
		if first.DestinationID != base.StopPlaceID || last.OriginPlaceID != base.StopPlaceID ||
			charge.PlaceID != base.StopPlaceID || !charge.EndedAt.After(charge.StartedAt) ||
			charge.StartedAt.Before(first.EndedAt) || charge.EndedAt.After(last.StartedAt) ||
			dwell <= 0 || dwell > tripReviewMaxStop {
			return nil
		}
		review.ObservedStopS = int64(dwell / time.Second)
		review.ObservedChargeS = int64(charge.EndedAt.Sub(charge.StartedAt) / time.Second)
		review.ExtraStopBudgetS = max(0, review.ObservedStopS-base.PlannedStopS)
	}
	return &review
}

func validTripReviewDrive(drive domain.TripReviewDrive, journey domain.TripReviewJourney) bool {
	return !drive.StartedAt.Before(journey.StartedAt) && drive.EndedAt.After(drive.StartedAt) &&
		!drive.EndedAt.After(journey.EndedAt)
}
