// Package smartreadiness declares storage boundaries for private readiness plans.
package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var (
	ErrNotFound  = errors.New("charging readiness resource not found")
	ErrLimit     = errors.New("too many charging readiness plans")
	ErrClaimLost = errors.New("charging readiness claim no longer valid")
)

type Claim struct {
	Plan  domain.Plan
	Token string
}

type Candidate struct {
	Plan           domain.Plan
	Decision       domain.Decision
	VehicleName    string
	PlaceName      string
	PlaceUpdatedAt time.Time
}

type SitePerformanceRepository interface {
	ListSitePerformanceScopes(context.Context, string, *int64, int) ([]domain.SitePerformanceScope, error)
	SaveSitePerformanceScope(context.Context, string, int64, *int64, time.Time) error
	ListSitePerformanceSessions(context.Context, string, domain.SitePerformanceScope, time.Time) ([]domain.SitePerformanceSession, error)
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
	ListLatestStartPlans(context.Context, string, int64, time.Time, int) ([]domain.Plan, error)
	ListSiteRateWindows(context.Context, []int64, time.Time, time.Time) ([]domain.SiteRateWindow, error)
	SavePlan(context.Context, string, domain.Plan, time.Time) (*domain.Plan, error)
	DeletePlan(context.Context, string, int64, int64) error
	SnoozePlan(context.Context, string, int64, int64, *time.Time, time.Time) error
	ClaimDue(context.Context, time.Time, bool) (*Claim, error)
	FinishClaim(context.Context, Claim, domain.Decision, time.Time) error
	ListCandidates(context.Context, string, *int64, time.Time, int) ([]Candidate, error)
	FindCandidate(context.Context, string, int64, int64, time.Time) (*Candidate, error)
}
