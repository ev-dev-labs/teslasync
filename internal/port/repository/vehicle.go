package repository

import (
	"context"

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

// VehicleStateRepository was deleted alongside the vehicle_states table.
// Current vehicle state is now derived from the
// in-memory FSM (internal/api/fsm_handler.go) and durably logged via
// fsm_transitions; the snapshot-row contract had no SI replacement.
