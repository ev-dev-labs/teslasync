package smartreadiness

import "time"

type TripReviewBaseline struct {
	VehicleID         int64
	JourneyID         int64
	OriginPlaceID     int64
	DestinationID     int64
	StopPlaceID       int64
	SavedAt           time.Time
	DepartureAt       time.Time
	PlannedArrivalPct float64
	PlannedStopS      int64
}

type TripReviewJourney struct {
	ID, VehicleID      int64
	StartedAt, EndedAt time.Time
	Drives             []TripReviewDrive
	ChargeSessions     []TripReviewCharge
}

type TripReviewDrive struct {
	OriginPlaceID, DestinationID int64
	StartedAt, EndedAt           time.Time
	EndChargePct                 *float64
	EndChargeObservedAt          *time.Time
}

type TripReviewCharge struct {
	PlaceID            int64
	StartedAt, EndedAt time.Time
}

type TripPlanReview struct {
	ArrivedAt           time.Time `json:"arrived_at"`
	ExpiresAt           time.Time `json:"expires_at"`
	PlannedArrivalPct   float64   `json:"planned_arrival_pct"`
	ObservedArrivalPct  float64   `json:"observed_arrival_pct"`
	PlannedStopS        int64     `json:"planned_stop_s"`
	ObservedStopS       int64     `json:"observed_stop_s"`
	ObservedChargeS     int64     `json:"observed_charge_s"`
	ExtraStopBudgetS    int64     `json:"extra_stop_budget_s"`
	ArrivalShortfallPct float64   `json:"arrival_shortfall_pct"`
}

type TripReviewSetup struct {
	JourneyID            int64      `json:"journey_id"`
	PlanVersion          int64      `json:"plan_version"`
	OriginUpdatedAt      time.Time  `json:"origin_updated_at"`
	DestinationID        int64      `json:"destination_id"`
	DestinationUpdatedAt time.Time  `json:"destination_updated_at"`
	StopPlaceID          *int64     `json:"stop_place_id"`
	StopPlaceUpdatedAt   *time.Time `json:"stop_place_updated_at"`
	PlannedArrivalPct    float64    `json:"planned_arrival_pct"`
	PlannedStopS         int64      `json:"planned_stop_s"`
}

type TripReviewAdjustment struct {
	SavedAt         time.Time `json:"saved_at"`
	ExtraStopS      int64     `json:"extra_stop_s"`
	ExtraArrivalPct float64   `json:"extra_arrival_pct"`
}

type SimilarTripReviewAdjustment struct {
	TripReviewAdjustment
	ExpiresAt time.Time `json:"expires_at"`
}

type TripReviewState struct {
	HasSetup          bool                         `json:"has_setup"`
	Setup             *TripReviewSetup             `json:"setup"`
	Review            *TripPlanReview              `json:"review"`
	AdjustmentKey     string                       `json:"adjustment_key,omitempty"`
	Adjustment        *TripReviewAdjustment        `json:"adjustment"`
	SimilarAdjustment *SimilarTripReviewAdjustment `json:"similar_adjustment"`
}

type TripReviewSnapshot struct {
	ScopedRevision    int64
	Setup             TripReviewSetup
	Baseline          TripReviewBaseline
	Journey           TripReviewJourney
	HasCompleted      bool
	Adjustment        *TripReviewAdjustment
	SimilarAdjustment *SimilarTripReviewAdjustment
}
