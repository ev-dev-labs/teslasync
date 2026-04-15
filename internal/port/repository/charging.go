package repository

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
)

// ChargingSessionRepository defines the persistence interface for charging sessions.
type ChargingSessionRepository interface {
	GetByID(ctx context.Context, id string) (*charging.ChargingSession, error)
	GetByVehicleID(ctx context.Context, vehicleID string) ([]charging.ChargingSession, error)
	ListByDateRange(ctx context.Context, vehicleID string, from, to time.Time) ([]charging.ChargingSession, error)
	Save(ctx context.Context, s *charging.ChargingSession) error
	GetByIDForUpdate(ctx context.Context, id string) (*charging.ChargingSession, error)
}
