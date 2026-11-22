package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrWindowRainChanged = errors.New("private window rain plan or delivery changed")

type WindowRainForecastSource interface {
	ForecastRain(ctx context.Context, latitude, longitude float64, authorize func(context.Context) error) (domain.RainForecast, error)
}

type WindowRainScope struct {
	Subject   string
	VehicleID int64
}

type WindowRainJob struct {
	Scope      WindowRainScope
	Plan       domain.WindowRainPlan
	LeaseUntil time.Time
}

type WindowRainCheck struct {
	Reason    domain.WindowRainReason
	Risk      *domain.WindowRainRisk
	NextCheck *time.Time
}

type WindowRainRepository interface {
	ReadWindowRain(context.Context, WindowRainScope) (*domain.WindowRainPlan, error)
	ReplaceWindowRain(context.Context, WindowRainScope, int64, domain.WindowRainSetup, domain.WeatherGrid, time.Time, time.Time) error
	PauseWindowRain(context.Context, WindowRainScope, int64) error
	DeleteWindowRain(context.Context, WindowRainScope, int64) error
	ClaimWindowRain(context.Context, time.Time, time.Time) (*WindowRainJob, error)
	WindowRainParkEnded(ctx context.Context, vehicle int64, parkedAt, confirmedAt, now time.Time) (bool, error)
	WindowRainLeaseActive(context.Context, WindowRainJob, time.Time) (bool, error)
	FinishWindowRain(context.Context, WindowRainJob, WindowRainCheck, time.Time) (bool, error)
	ExpireWindowRain(context.Context, time.Time) error
}
