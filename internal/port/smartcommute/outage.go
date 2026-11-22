package smartcommute

import (
	"context"
	"errors"
	"time"
)

type EstimateFeed string

const (
	HEREImport EstimateFeed = "here_import"
	HERERoutes EstimateFeed = "here_routes"
	HEREFlow   EstimateFeed = "here_flow"
)

var ErrEstimatesPaused = errors.New("upstream estimates temporarily unavailable")

type EstimateAttempt struct {
	StartedAt time.Time
	OutageAt  time.Time
	Recovery  bool
}

type EstimateIncident struct {
	ID         int64
	Feed       EstimateFeed
	StartedAt  time.Time
	ResolvedAt *time.Time
}

// EstimateHealth records only explicit service unavailability and fresh
// usable responses; transport errors and request-specific failures aren't health.
type EstimateHealth interface {
	BeginEstimate(context.Context, EstimateFeed) (EstimateAttempt, error)
	FinishEstimate(context.Context, EstimateFeed, EstimateAttempt, bool) error
}
