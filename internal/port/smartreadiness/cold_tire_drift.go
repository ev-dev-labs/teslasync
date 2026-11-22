package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrColdTireSeriesChanged = errors.New("cold tire series changed or reading is not later than the previous reading")

type ColdTireScope struct {
	Subject   string
	VehicleID int64
}

type ColdTireWindow struct {
	Now        time.Time
	From       time.Time
	MinSpacing time.Duration
}

type ColdTireEvaluator func([]domain.ColdTireReading) (*domain.ColdTireDrift, domain.ColdTireDriftReason)

type ColdTireCandidate struct {
	VehicleID   int64
	VehicleName string
	ReviewID    int64
	Occurrence  int64
	Drift       domain.ColdTireDrift
}

type ColdTireRepository interface {
	ReadColdTireReview(context.Context, ColdTireScope, time.Time) (domain.ColdTireReview, error)
	AppendColdTireReading(context.Context, ColdTireScope, int64, domain.ColdTireReading, ColdTireWindow, ColdTireEvaluator) (domain.ColdTireDriftReason, bool, error)
	DeleteColdTireReview(context.Context, ColdTireScope, int64) error
	ListColdTireDrift(context.Context, string, *int64, time.Time, int) ([]ColdTireCandidate, error)
}
