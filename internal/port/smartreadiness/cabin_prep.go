package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrCabinPrepChanged = errors.New("private cabin prep plan changed")

type CabinDepartureHistory interface {
	CabinDepartures(context.Context, int64, time.Time, time.Time, *time.Location) ([]time.Time, error)
}

type CabinPrepScope struct {
	VehicleID int64
	Subject   string
}

type CabinPrepJob struct {
	Plan       domain.CabinPrepPlan
	Subject    string
	LeaseUntil time.Time
	Forecast   *domain.CabinPrepForecast
}

type CabinPrepResult struct {
	Reason    domain.CabinPrepReason
	NextCheck *time.Time
	Forecast  *domain.CabinPrepForecast
	ExpiresAt *time.Time
}

type CabinPrepRepository interface {
	ReadCabinPrep(context.Context, CabinPrepScope, time.Time) (domain.CabinPrepPlan, error)
	ReplaceCabinPrep(context.Context, CabinPrepScope, int64, domain.CabinPrepSetup, time.Time, time.Time) error
	DeleteCabinPrep(context.Context, CabinPrepScope, int64) error
	ClaimCabinPrep(context.Context, time.Time, time.Time) (*CabinPrepJob, error)
	CabinPrepStillCurrent(context.Context, CabinPrepJob, time.Time) (bool, error)
	CabinDriveStarted(context.Context, int64, time.Time, time.Time) (bool, error)
	CabinParkContinuous(context.Context, int64, time.Time, time.Time) (bool, error)
	CabinHVACOffContinuous(context.Context, int64, time.Time, time.Time) (bool, error)
	FinishCabinPrep(context.Context, CabinPrepJob, CabinPrepResult, time.Time) (bool, error)
}
