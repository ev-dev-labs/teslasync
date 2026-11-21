package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrParkReserveChanged = errors.New("private parked-reserve plan changed")

type ParkReserveWindow struct {
	Start time.Time
	End   time.Time
}

type ParkReserveWindows interface {
	ParkReserveWindows(context.Context, int64, time.Time, time.Time, time.Duration) ([]ParkReserveWindow, error)
}

type ParkReserveScope struct {
	Subject   string
	VehicleID int64
}

type ParkReserveJob struct {
	Plan       domain.ParkReservePlan
	LeaseUntil time.Time
}

type ParkReserveResult struct {
	Reason    domain.ParkReserveReason
	Forecast  *domain.ParkReserveForecast
	NextCheck *time.Time
}

type ParkReserveRepository interface {
	ReadParkReserve(context.Context, ParkReserveScope) (*domain.ParkReservePlan, error)
	ReplaceParkReserve(context.Context, ParkReserveScope, int64, domain.ParkReserveSetup, time.Time, time.Time) error
	DeleteParkReserve(context.Context, ParkReserveScope, int64) error
	ClaimParkReserve(context.Context, time.Time, time.Time) (*ParkReserveJob, error)
	ParkReserveActivity(context.Context, int64, time.Time, time.Time) (bool, error)
	FinishParkReserve(context.Context, ParkReserveJob, ParkReserveResult, time.Time) (bool, error)
}
