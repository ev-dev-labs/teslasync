package trippacket

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/trippacket"
)

var (
	ErrNotFound   = errors.New("private trip packet not found")
	ErrChanged    = errors.New("private trip packet changed")
	ErrReceiptDay = errors.New("the entered receipt day does not match the drive")
)

type Scope struct {
	Subject   string
	VehicleID int64
}

type Job struct {
	Scope
	domain.Plan
	Lease time.Time
}

type Window struct {
	From, Through time.Time
}

type Repository interface {
	Read(ctx context.Context, scope Scope) (*domain.Plan, error)
	Replace(ctx context.Context, scope Scope, plan domain.Plan, next time.Time) error
	Delete(ctx context.Context, scope Scope, version domain.Version) error
	Dismiss(ctx context.Context, scope Scope, version domain.Version, through time.Time) error
	ReadEntry(ctx context.Context, scope Scope, plan domain.Plan, driveID int64, now time.Time) (*domain.Entry, error)
	ReplaceEntry(ctx context.Context, scope Scope, plan domain.Plan, entry domain.Entry, now time.Time, refresh Window) error
	Claim(ctx context.Context, now, lease time.Time) (*Job, error)
	Sources(ctx context.Context, scope Scope, version domain.Version, window Window, now time.Time, lease *time.Time) ([]domain.Drive, []domain.Receipt, error)
	Finish(ctx context.Context, job Job, now, next, through time.Time, ready bool) (bool, error)
}
