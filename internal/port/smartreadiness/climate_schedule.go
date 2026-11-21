package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrClimateScheduleChanged = errors.New("private climate schedule review changed")

type ClimateScheduleScope struct {
	Subject   string
	VehicleID int64
}

type DueClimateSchedule struct {
	PlanID    int64
	VehicleID int64
	TimeZone  string
	Lease     time.Time
}

type ClimateScheduleCandidate struct {
	PlanID      int64
	VehicleID   int64
	VehicleName string
	Automation  domain.ClimateScheduleVersion
	Evidence    domain.ClimateScheduleEvidence
}

type ClimateScheduleCompletion struct {
	Applied   bool
	Published bool
}

type ClimateScheduleRepository interface {
	ReadClimateSchedule(context.Context, ClimateScheduleScope, time.Time) (domain.ClimateScheduleSettings, error)
	ReplaceClimateSchedule(context.Context, ClimateScheduleScope, int64, int64, time.Time, time.Time) error
	DeleteClimateSchedule(context.Context, ClimateScheduleScope, int64) error
	ClaimClimateSchedule(context.Context, time.Time, time.Time) (*DueClimateSchedule, error)
	ClimateScheduleRuns(context.Context, DueClimateSchedule, time.Time, time.Time) ([]domain.ClimateScheduleRun, error)
	FinishClimateSchedule(context.Context, DueClimateSchedule, time.Time, time.Time, *domain.ClimateScheduleEvidence) (ClimateScheduleCompletion, error)
	ListClimateScheduleReviews(context.Context, string, *int64, time.Time, int) ([]ClimateScheduleCandidate, error)
}
