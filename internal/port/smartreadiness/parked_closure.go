package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrParkedClosureChanged = errors.New("parked closure plan changed")

type ParkedClosureScope struct {
	Subject   string
	VehicleID int64
}

type ParkedClosureJob struct {
	Scope      ParkedClosureScope
	Plan       domain.ParkedClosurePlan
	LeaseUntil time.Time
}

type ParkedClosureRepository interface {
	ReadParkedClosure(context.Context, ParkedClosureScope) (*domain.ParkedClosurePlan, error)
	ReplaceParkedClosure(context.Context, ParkedClosureScope, int64, domain.ParkedClosureSetup, time.Time) error
	SetParkedClosureHold(context.Context, ParkedClosureScope, int64, *time.Time) error
	DeleteParkedClosure(context.Context, ParkedClosureScope, int64) error
	ClaimParkedClosure(context.Context, time.Time, time.Time) (*ParkedClosureJob, error)
	FinishParkedClosure(context.Context, ParkedClosureJob, domain.ParkedClosureReason, *domain.ParkedClosureRisk, time.Time) (bool, error)
}
