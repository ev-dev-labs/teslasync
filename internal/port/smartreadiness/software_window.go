package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrSoftwareWindowChanged = errors.New("private software window changed")

type SoftwareWindowScope struct {
	Subject   string
	VehicleID int64
}

type SoftwareWindowRepository interface {
	ReadSoftwareWindow(context.Context, SoftwareWindowScope) (*domain.SoftwareWindowPlan, error)
	ReplaceSoftwareWindow(ctx context.Context, scope SoftwareWindowScope, expectedID int64, setup domain.SoftwareWindowSetup, now time.Time) error
	HoldSoftwareWindow(ctx context.Context, scope SoftwareWindowScope, expectedID int64, until *time.Time, now time.Time) error
	DeleteSoftwareWindow(context.Context, SoftwareWindowScope, int64) error
	CheckSoftwareWindow(ctx context.Context, scope SoftwareWindowScope, expectedID int64, parkAt, now time.Time) (bool, error)
}
