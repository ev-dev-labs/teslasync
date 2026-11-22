package smartcommute

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

type NavigationScope struct {
	Subject      string
	VehicleID    int64
	RoutineID    int64
	OccurrenceID string
	WorkAt       *time.Time
}

type NavigationOccurrence struct {
	VIN         string
	Origin      domain.Point
	DepartureAt time.Time
	ExpiresAt   time.Time
	Outcome     domain.NavigationOutcome
	WorkAt      time.Time
}

type NavigationRepository interface {
	FindNavigationOccurrence(context.Context, NavigationScope, time.Time) (*NavigationOccurrence, error)
	ClaimNavigationAttempt(context.Context, NavigationScope, time.Time) (bool, error)
	FinishNavigationAttempt(context.Context, NavigationScope, time.Time, domain.NavigationOutcome) error
}

type NavigationExecutor interface {
	Connectivity(context.Context, string) string
	CanWake(context.Context) bool
	Wake(context.Context, string, func(context.Context) error) (string, domain.NavigationOutcome)
	Send(context.Context, string, string, func(context.Context) error) domain.NavigationOutcome
}
