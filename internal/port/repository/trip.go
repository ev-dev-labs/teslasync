package repository

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
)

// TripRepository defines the persistence interface for trips.
type TripRepository interface {
	GetByID(ctx context.Context, id string) (*trip.Trip, error)
	GetByVehicleID(ctx context.Context, vehicleID string) ([]trip.Trip, error)
	ListByDateRange(ctx context.Context, vehicleID string, from, to time.Time) ([]trip.Trip, error)
	Save(ctx context.Context, t *trip.Trip) error
	GetByIDForUpdate(ctx context.Context, id string) (*trip.Trip, error)
}
