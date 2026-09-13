package fsdweekly

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/fsd"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/notification/fsddigest"
)

// AnalyticsInput is the bounded FSD analytics payload the weekly digest
// loader returns. Re-exported so cmd/notification-worker never imports
// internal/api (ADR-007 / depguard).
type AnalyticsInput = fsd.AnalyticsInput

// Sample is one raw FSD/driving distance observation.
type Sample = fsd.Sample

const (
	SignalFSDDistance     = fsd.SignalFSDDistance
	SignalDrivingDistance = fsd.SignalDrivingDistance
)

// Loader is the slice of fsd.Repo the digest tick needs.
type Loader interface {
	LoadAnalyticsInput(ctx context.Context, vehicleID int64, from, split, to time.Time) (AnalyticsInput, error)
}

var _ Loader = (*fsd.Repo)(nil)

// NewLoader wires the production pgx-backed FSD repo.
func NewLoader(db *database.DB) Loader {
	return fsd.NewRepo(db)
}

// LoadLocationOrUTC resolves an IANA name, falling back to UTC.
func LoadLocationOrUTC(name string) *time.Location {
	return fsd.LoadLocationOrUTC(name)
}

// CurrentWeekBounds returns the half-open Monday–next-Monday window in loc.
func CurrentWeekBounds(now time.Time, loc *time.Location) (time.Time, time.Time) {
	return fsd.CurrentWeekBounds(now, loc)
}

// Snapshot builds the weekly digest snapshot for one vehicle/week.
func Snapshot(
	ctx context.Context,
	loader Loader,
	vehicleID int64,
	loc *time.Location,
	weekStart, weekEnd time.Time,
) (fsddigest.Snapshot, error) {
	prevStart := fsd.PreviousWeekStart(weekStart, loc)
	input, err := loader.LoadAnalyticsInput(ctx, vehicleID, prevStart, weekStart, weekEnd)
	if err != nil {
		return fsddigest.Snapshot{}, err
	}
	current := fsd.Aggregate(fsd.AggregateParams{
		VehicleID: vehicleID,
		Days:      7,
		Loc:       loc,
		Start:     weekStart,
		End:       weekEnd,
		Samples:   input.CounterSamples,
	})
	previous := fsd.Aggregate(fsd.AggregateParams{
		VehicleID: vehicleID,
		Days:      7,
		Loc:       loc,
		Start:     prevStart,
		End:       weekStart,
		Samples:   input.PreviousCounterSamples,
	})
	current.Analytics = fsd.BuildDriveAnalytics(current, previous, input, loc, false)
	return fsddigest.Snapshot{
		VehicleID:      vehicleID,
		WeekStart:      weekStart,
		Location:       loc,
		FSDDistanceM:   current.Totals.FSDDistanceM,
		SharePct:       current.Totals.FSDSharePct,
		ShareChangePts: current.Analytics.Comparison.FSDShareChangePctPoints,
	}, nil
}
