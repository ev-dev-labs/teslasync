// Package smartreadiness declares storage boundaries for private readiness plans.
package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var (
	ErrNotFound     = errors.New("charging readiness resource not found")
	ErrLimit        = errors.New("too many charging readiness plans")
	ErrClaimLost    = errors.New("charging readiness claim no longer valid")
	ErrStopSetup    = errors.New("trip stop setup is invalid for this plan")
	ErrEarlierCheck = errors.New("earlier charging check proposal is no longer applicable")
	ErrPlanChanged  = errors.New("charging readiness plan changed")
)

type Claim struct {
	Plan          domain.Plan
	Token         string
	AdvicePaused  bool
	OverlapPaused bool
}

type Candidate struct {
	Plan           domain.Plan
	Decision       domain.Decision
	VehicleName    string
	PlaceName      string
	PlaceUpdatedAt time.Time
}

type EarlierCheckPlan struct {
	Plan           domain.Plan
	PlaceUpdatedAt time.Time
}

type LatestStartPlan struct {
	domain.Plan
	ReadinessAllowed bool
	WorkAt           time.Time
}

type SitePerformanceRepository interface {
	ListSitePerformanceScopes(context.Context, string, *int64, int) ([]domain.SitePerformanceScope, error)
	SaveSitePerformanceScope(context.Context, string, int64, *int64, time.Time) error
	ListSitePerformanceSessions(context.Context, string, domain.SitePerformanceScope, time.Time) ([]domain.SitePerformanceSession, error)
}

type TripStopRepository interface {
	HasStopSetup(context.Context, domain.StopPlanKey) (bool, error)
	ReadStopScope(context.Context, domain.StopPlanKey, time.Time) (*domain.StopComparisonScope, error)
	ReplaceStopSetup(context.Context, domain.StopPlanKey, domain.StopComparisonInput, time.Time) error
	DeleteStopSetup(context.Context, domain.StopPlanKey) error
	ClaimStopComparison(context.Context, domain.StopPlanKey, int64, time.Time, time.Time) (bool, error)
	CheckStopScope(context.Context, domain.StopPlanKey, int64, time.Time) error
	CheckStopWork(context.Context, domain.StopPlanKey, int64, time.Time) error
	ListStopChargeSessions(context.Context, domain.StopPlanKey, int64, int64, time.Time) ([]domain.SitePerformanceSession, error)
	ReadStopComparison(context.Context, domain.StopPlanKey, int64, time.Time) (*domain.StopComparisonResult, error)
	SaveStopComparison(context.Context, domain.StopPlanKey, int64, domain.StopComparisonResult) error
}

type TripReviewRepository interface {
	HasTripReview(context.Context, domain.StopPlanKey) (bool, error)
	ReplaceTripReview(context.Context, domain.StopPlanKey, domain.TripReviewSetup, time.Time) error
	DeleteTripReview(context.Context, domain.StopPlanKey) error
	ReadTripReview(context.Context, domain.StopPlanKey, time.Time) (*domain.TripReviewSnapshot, error)
	SaveTripAdjustment(context.Context, domain.StopPlanKey, time.Time, func(domain.TripReviewSnapshot) (*domain.TripReviewAdjustment, error)) error
}

type PublicFeeRepository interface {
	SavePublicFeeTerms(context.Context, domain.PublicFeeTerms) error
	DeletePublicFeeTerms(context.Context, string, int64) error
	HasPublicFeeTerms(context.Context, string, int64) (bool, error)
	FindPublicFeeTerms(context.Context, string, int64, time.Time) (*domain.PublicFeeTerms, error)
	FindPublicChargeCompletion(context.Context, domain.PublicFeeTerms, time.Time) (*domain.PublicChargeCompletion, error)
	ListDuePublicFeeRecipients(context.Context, time.Time, int) ([]domain.PublicFeeRecipient, error)
	PrunePublicFeeDeliveries(context.Context, time.Time) error
}

type SolarChargingRepository interface {
	SaveSolarChargingPlan(context.Context, domain.SolarChargingPlan) error
	DeleteSolarChargingPlan(context.Context, string, int64) error
	FindSolarChargingPlan(context.Context, string, int64) (*domain.SolarChargingPlan, error)
	ListSolarChargingScopes(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]domain.SolarChargingScope, error)
	ClaimDueSolarChargingPlans(ctx context.Context, now, next time.Time, limit int, sharedOpenMode bool) ([]domain.SolarChargingPlan, error)
	SaveSolarChargingObservation(context.Context, domain.SolarChargingPlan, *domain.SolarBackupReserve, domain.SolarSurplusObservation, time.Time) error
	InvalidateSolarChargingEvidence(context.Context, domain.SolarChargingPlan, time.Time) error
	ListSolarChargingObservations(context.Context, domain.SolarChargingPlan, time.Time, time.Time) ([]domain.SolarSurplusObservation, error)
	PruneSolarChargingObservations(context.Context, time.Time) error
}

type Repository interface {
	ListPlans(context.Context, string, int64, int, int) ([]domain.Plan, error)
	ListActivePlans(context.Context, string, int64, time.Time, int) ([]domain.Plan, error)
	ListLatestStartPlans(ctx context.Context, subject string, vehicleID int64, now time.Time, limit int, workAt *time.Time) ([]LatestStartPlan, error)
	ReadEarlierCheckPlan(context.Context, domain.StopPlanKey) (EarlierCheckPlan, error)
	AdvanceCheck(context.Context, EarlierCheckPlan, time.Time, time.Time, time.Time) error
	ListSiteRateWindows(context.Context, []int64, time.Time, time.Time) ([]domain.SiteRateWindow, error)
	ListChargeRemedySessions(context.Context, Candidate, time.Time) ([]domain.SitePerformanceSession, error)
	PriorInterruptedChargingPower(context.Context, domain.Plan, time.Time, time.Time) (float64, error)
	SavePlan(context.Context, string, domain.Plan, time.Time) (*domain.Plan, error)
	DeletePlan(context.Context, string, int64, int64) error
	SnoozePlan(context.Context, string, int64, int64, *time.Time, time.Time) error
	ClaimDue(context.Context, time.Time, bool) (*Claim, error)
	FinishClaim(ctx context.Context, claim Claim, charging, overlap domain.Decision, now time.Time) error
	ListCandidates(context.Context, string, *int64, time.Time, int) ([]Candidate, error)
	FindCandidate(context.Context, string, int64, int64, domain.DecisionKind, time.Time) (*Candidate, error)
}
