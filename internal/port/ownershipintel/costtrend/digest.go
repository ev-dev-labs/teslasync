package costtrend

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
)

var (
	ErrNotFound = errors.New("charging cost review not found")
	ErrChanged  = errors.New("charging cost review changed")
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
	ReadClaimedCostPeriods(ctx context.Context, job Job, from, midpoint, end time.Time) (domain.Period, domain.Period, error)
}

type Repository interface {
	Read(ctx context.Context, scope Scope, now time.Time) (domain.Review, error)
	Replace(ctx context.Context, scope Scope, settings domain.Settings, next *time.Time) error
	Delete(ctx context.Context, scope Scope, settingsID int64) error
	Dismiss(ctx context.Context, scope Scope, settingsID int64, through, now time.Time) error
	Claim(ctx context.Context, now, lease time.Time) (*Job, error)
	Finish(ctx context.Context, job Job, checkedAt, next time.Time, digest *domain.Digest) (bool, error)
}
