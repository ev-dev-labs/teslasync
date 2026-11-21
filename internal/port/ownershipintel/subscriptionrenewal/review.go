package subscriptionrenewal

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	renewal "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/subscriptionrenewal"
)

var (
	ErrNotFound = errors.New("subscription not found")
	ErrChanged  = errors.New("subscription renewal changed")
)

type Scope struct {
	Subject        string
	VehicleID      int64
	SubscriptionID int64
}

type Plan struct {
	renewal.Terms
	Revision            string     `json:"revision"`
	SubscriptionVersion int        `json:"subscription_version"`
	Paused              bool       `json:"paused"`
	NextCheckAt         *time.Time `json:"next_check_at"`
	ReviewedAt          *time.Time `json:"-"`
	Dismissed           bool       `json:"-"`
}

type Job struct {
	Scope
	Plan
	Subscription domain.Subscription
	Lease        time.Time
}

type Candidate struct {
	OccurrenceID   string
	SubscriptionID int64
	VehicleID      int64
	VehicleName    string
	PublishedAt    time.Time
	ExpiresAt      time.Time
}

type Repository interface {
	Read(context.Context, Scope) (domain.Subscription, *Plan, error)
	Replace(context.Context, Scope, Plan, time.Time, time.Time) error
	Delete(context.Context, Scope, string) error
	Dismiss(context.Context, Scope, string, time.Time) error
	Claim(context.Context, time.Time, time.Time) (*Job, error)
	Finish(context.Context, Job, time.Time, bool) (bool, error)
	Observations(context.Context, Scope, Plan, domain.Subscription, renewal.Window, time.Time) ([]renewal.Observation, error)
	FindCandidates(context.Context, string, *int64, time.Time, int) ([]Candidate, error)
}
