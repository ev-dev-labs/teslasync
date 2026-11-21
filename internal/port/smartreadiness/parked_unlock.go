package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrParkedUnlockChanged = errors.New("parked unlock plan or monitored place changed")

type ParkedUnlockScope struct {
	Subject   string
	VehicleID int64
}

type ParkedUnlockJob struct {
	Scope      ParkedUnlockScope
	Plan       domain.ParkedUnlockPlan
	LeaseUntil time.Time
}

type ParkedUnlockRepository interface {
	ReadParkedUnlock(context.Context, ParkedUnlockScope) (*domain.ParkedUnlockPlan, error)
	ReplaceParkedUnlock(context.Context, ParkedUnlockScope, int64, domain.ParkedUnlockSetup, time.Time) error
	SetParkedUnlockHold(context.Context, ParkedUnlockScope, int64, *time.Time) error
	DeleteParkedUnlock(context.Context, ParkedUnlockScope, int64) error
	ClaimParkedUnlock(context.Context, time.Time, time.Time) (*ParkedUnlockJob, error)
	FinishParkedUnlock(context.Context, ParkedUnlockJob, domain.ParkedUnlockReason, *domain.ParkedUnlockRisk, time.Time) (bool, error)
}
