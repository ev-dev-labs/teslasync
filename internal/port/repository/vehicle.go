package repository

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
)

// VehicleRepository defines the persistence interface for vehicles.
type VehicleRepository interface {
	GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error)
	GetByUserID(ctx context.Context, userID string) ([]vehicle.Vehicle, error)
	GetByVIN(ctx context.Context, vin string) (*vehicle.Vehicle, error)
	Save(ctx context.Context, v *vehicle.Vehicle) error
	Delete(ctx context.Context, id string) error
	GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error)
}

// VehicleStateRepository provides vehicle state snapshot operations.
type VehicleStateRepository interface {
	SaveSnapshot(ctx context.Context, vehicleID string, state map[string]interface{}, timestamp time.Time) error
	GetLatestSnapshot(ctx context.Context, vehicleID string) (map[string]interface{}, error)
}
