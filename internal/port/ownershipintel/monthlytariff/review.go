package monthlytariff

import (
	"context"
	"errors"
	"time"

	ownership "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
)

var (
	ErrNotFound = errors.New("monthly tariff review not found")
	ErrChanged  = errors.New("monthly tariff review changed")
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

type EvidenceReader interface {
	ReadEvidence(ctx context.Context, job Job, from, through time.Time) (domain.Month, ownership.Tariff, ownership.Tariff, error)
}

type Repository interface {
	Read(ctx context.Context, scope Scope, now time.Time) (domain.Review, error)
	Replace(ctx context.Context, scope Scope, settings domain.Settings, next *time.Time) error
	Delete(ctx context.Context, scope Scope, id int64) error
	Dismiss(ctx context.Context, scope Scope, id int64, through, now time.Time) error
	Claim(ctx context.Context, now, lease time.Time) (*Job, error)
	Finish(ctx context.Context, job Job, now, next time.Time, digest *domain.Digest) (bool, error)
}
