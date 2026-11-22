package mileageterm

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/mileageterm"
)

var (
	ErrNotFound = errors.New("mileage review not found")
	ErrChanged  = errors.New("mileage review changed")
)

type Scope struct {
	Subject   string
	VehicleID int64
}

type Job struct {
	Scope
	domain.Settings
	Lease time.Time
}

type Repository interface {
	Read(ctx context.Context, scope Scope, now time.Time) (domain.Review, error)
	Replace(ctx context.Context, scope Scope, settings domain.Settings, next *time.Time, cutoff time.Time) error
	Delete(ctx context.Context, scope Scope, planID int64) error
	Dismiss(ctx context.Context, scope Scope, planID int64, through, now time.Time) error
	Claim(ctx context.Context, now, lease time.Time) (*Job, error)
	ReadObservations(ctx context.Context, job Job, from, through, now time.Time) ([]domain.Observation, error)
	Finish(ctx context.Context, job Job, now, nextCycle time.Time, next *time.Time, digest *domain.Digest) (bool, error)
}
