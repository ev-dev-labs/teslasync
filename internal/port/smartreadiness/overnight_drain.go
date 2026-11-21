package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrOvernightDrainChanged = errors.New("private overnight drain plan changed")

type OvernightDrainScope struct {
	Subject   string
	VehicleID int64
}

type DueOvernightDrain struct {
	PlanID    int64
	VehicleID int64
	TimeZone  string
	Lease     time.Time
}

type OvernightDrainRepository interface {
	ReadOvernightDrain(context.Context, OvernightDrainScope, time.Time) (domain.OvernightDrainSettings, error)
	ReplaceOvernightDrain(context.Context, OvernightDrainScope, int64, string, *time.Time) error
	DeleteOvernightDrain(context.Context, OvernightDrainScope, int64) error
	DismissOvernightDrain(context.Context, OvernightDrainScope, int64, time.Time, time.Time) error
	ClaimOvernightDrain(context.Context, time.Time, time.Time) (*DueOvernightDrain, error)
	FinishOvernightDrain(context.Context, DueOvernightDrain, time.Time, time.Time, *domain.OvernightDrainReview) (bool, error)
}
