package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrCapacityTrendChanged = errors.New("private capacity digest plan changed")

type CapacityTrendScope struct {
	Subject   string
	VehicleID int64
}

type DueCapacityTrend struct {
	PlanID    int64
	VehicleID int64
	TimeZone  string
	Lease     time.Time
}

type CapacityTrendRepository interface {
	ReadCapacityTrend(context.Context, CapacityTrendScope, time.Time) (domain.CapacityTrendSettings, error)
	ReplaceCapacityTrend(context.Context, CapacityTrendScope, int64, string, *time.Time) error
	DeleteCapacityTrend(context.Context, CapacityTrendScope, int64) error
	DismissCapacityTrend(context.Context, CapacityTrendScope, int64, time.Time, time.Time) error
	ClaimCapacityTrend(context.Context, time.Time, time.Time) (*DueCapacityTrend, error)
	FinishCapacityTrend(context.Context, DueCapacityTrend, time.Time, time.Time, *domain.CapacityTrendDigest) (bool, error)
}
