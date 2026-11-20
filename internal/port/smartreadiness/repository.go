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
